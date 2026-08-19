/**
 * lib/consent.json → MongoDB Atlas (nonhyun.consent)
 *
 *   npm run migrate:consent
 *
 * 엑셀에서 뽑은 참여의향서 명부를 DB 로 옮긴다.
 * pnu 를 _id 로 써서 여러 번 돌려도 같은 필지는 덮어쓰기만 된다.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = resolve(ROOT, "lib/consent.json");
const CREDENTIALS = resolve(ROOT, "atlas-credentials.env");
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

const consent = JSON.parse(readFileSync(SOURCE, "utf8"));
const docs = Object.values(consent).map((c) => ({ ...c, _id: c.pnu }));

if (!docs.length) {
  console.error("옮길 자료가 없습니다.");
  process.exit(1);
}

const client = new MongoClient(uri(), { serverSelectionTimeoutMS: 15000 });

try {
  await client.connect();
  const col = client.db(DB_NAME).collection(COLLECTION);

  const result = await col.bulkWrite(
    docs.map((doc) => ({
      replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true },
    })),
    { ordered: false },
  );

  // 명부에서 빠진 필지는 DB 에도 남으면 안 된다
  const removed = await col.deleteMany({ _id: { $nin: docs.map((d) => d._id) } });

  const total = await col.countDocuments();
  const submitted = await col
    .aggregate([{ $group: { _id: null, n: { $sum: "$submitted" } } }])
    .toArray();

  console.log(
    `추가 ${result.upsertedCount} · 갱신 ${result.modifiedCount} · 삭제 ${removed.deletedCount}`,
  );
  console.log(`${DB_NAME}.${COLLECTION}: 필지 ${total}건 · 제출 ${submitted[0]?.n ?? 0}호`);
} finally {
  await client.close();
}
