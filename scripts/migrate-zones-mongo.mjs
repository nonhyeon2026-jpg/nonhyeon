/**
 * data/zones.json → MongoDB Atlas (nonhyun.zones)
 *
 *   npm run migrate:zones
 *
 * 구역 정보와 편입 필지 목록을 DB 로 옮긴다.
 * 구역 id 를 _id 로 써서 여러 번 돌려도 같은 구역은 덮어쓰기만 된다.
 * order 는 화면에 나오는 순서 — 파일에 있던 순서를 그대로 유지한다.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = resolve(ROOT, "data/zones.json");
const CREDENTIALS = resolve(ROOT, "atlas-credentials.env");
const DB_NAME = process.env.MONGODB_DB ?? "nonhyun";
const COLLECTION = "zones";

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

const zones = JSON.parse(readFileSync(SOURCE, "utf8"));
if (!Array.isArray(zones) || !zones.length) {
  console.error("옮길 구역이 없습니다.");
  process.exit(1);
}

const client = new MongoClient(uri(), { serverSelectionTimeoutMS: 15000 });

try {
  await client.connect();
  const col = client.db(DB_NAME).collection(COLLECTION);

  const result = await col.bulkWrite(
    zones.map((zone, i) => ({
      replaceOne: {
        filter: { _id: zone.id },
        replacement: { ...zone, _id: zone.id, order: i },
        upsert: true,
      },
    })),
    { ordered: false },
  );

  const total = await col.countDocuments();
  const parcels = await col
    .aggregate([{ $group: { _id: null, n: { $sum: { $size: "$parcels" } } } }])
    .toArray();

  console.log(`추가 ${result.upsertedCount} · 갱신 ${result.modifiedCount}`);
  console.log(`${DB_NAME}.${COLLECTION}: 구역 ${total}개 · 편입 필지 ${parcels[0]?.n ?? 0}개`);
} finally {
  await client.close();
}
