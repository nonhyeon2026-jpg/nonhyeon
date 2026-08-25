/**
 * 여러 지번에 걸친 집합건물을 하나의 참여의향서 명부로 묶는다.
 *
 *   node scripts/link-consent.mjs 176-2 176-3 [176-5 …]
 *   npm run link:consent -- 176-2 176-3
 *
 * 첫 번째가 건축물대장이 등재된 대표 지번, 나머지가 같은 건물이 앉은 딸림 지번이다.
 * 딸림 지번은 대표의 명부를 그대로 쓰고 총 호수는 한 번만 세어진다 (lib/consent.ts).
 *
 * 관리자 화면(필지 선택 → 참여의향서 수정)에서도 같은 일을 할 수 있다.
 * 이 스크립트는 여러 건을 한꺼번에 정리할 때 쓴다.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CREDENTIALS = resolve(ROOT, "atlas-credentials.env");
const PARCELS = resolve(ROOT, "public/parcels.json");
const DB_NAME = process.env.MONGODB_DB || "nonhyun";
const COLLECTION = "consent";

/** KEY="value" / KEY=value 형태만 읽는 최소 파서 */
function readEnvFile(file) {
  const out = {};
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return out;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2].trim().replace(/^["'](.*)["']$/, "$1");
  }
  return out;
}

function uri() {
  if (process.env.MONGODB_URI) return process.env.MONGODB_URI;
  const file = readEnvFile(CREDENTIALS);
  if (!file.MONGODB_URI) {
    throw new Error("MONGODB_URI 를 찾지 못했습니다 (환경변수 또는 atlas-credentials.env).");
  }
  if (file.MONGODB_URI.includes("<db_password>") && file.MONGODB_PASSWORD) {
    return file.MONGODB_URI.replace("<db_password>", encodeURIComponent(file.MONGODB_PASSWORD));
  }
  return file.MONGODB_URI;
}

const [primaryJibun, ...annexJibuns] = process.argv.slice(2);
if (!primaryJibun || !annexJibuns.length) {
  console.error("사용법: node scripts/link-consent.mjs <대표지번> <딸림지번…>   예) 176-2 176-3");
  process.exit(1);
}

const parcels = JSON.parse(readFileSync(PARCELS, "utf8"));
const pnuOf = new Map(parcels.features.map((f) => [f.properties.jibun, f.properties.pnu]));

const resolveJibun = (j) => {
  const pnu = pnuOf.get(j);
  if (!pnu) throw new Error(`지적도에 없는 지번입니다: ${j}`);
  return pnu;
};

const primary = resolveJibun(primaryJibun);
const annexes = annexJibuns.map(resolveJibun);

const client = new MongoClient(uri(), { serverSelectionTimeoutMS: 15000 });

try {
  await client.connect();
  const col = client.db(DB_NAME).collection(COLLECTION);

  const doc = await col.findOne({ _id: primary });
  if (!doc) {
    throw new Error(
      `논현동 ${primaryJibun} 은 명부에 없습니다. 대표 지번은 참여의향서가 등록된 지번이어야 합니다.`,
    );
  }

  // 딸림 지번이 제 명부를 갖고 있으면 같은 건물이 두 번 세어진다
  const owned = await col.find({ _id: { $in: annexes } }).toArray();
  if (owned.length) {
    throw new Error(
      `${owned.map((d) => `논현동 ${d.jibun}`).join(", ")} 에 별도 명부가 있습니다. 먼저 정리하세요.`,
    );
  }

  // 다른 건물이 물고 있던 지번은 놓게 한다 (한 필지는 한 건물)
  await col.updateMany(
    { _id: { $ne: primary }, sharedPnus: { $in: annexes } },
    { $pull: { sharedPnus: { $in: annexes } } },
  );

  const merged = [...new Set([...(doc.sharedPnus ?? []), ...annexes])];
  await col.updateOne({ _id: primary }, { $set: { sharedPnus: merged } });

  console.log(
    `논현동 ${primaryJibun} (${doc.submitted}/${doc.total}호) ← ${annexJibuns
      .map((j) => `논현동 ${j}`)
      .join(", ")} 를 같은 건물로 묶었습니다.`,
  );
} finally {
  await client.close();
}
