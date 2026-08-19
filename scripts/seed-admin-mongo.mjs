/**
 * 관리자 계정 → MongoDB Atlas (nonhyun.admins)
 *
 *   ADMIN_ID=아이디 ADMIN_PW=비밀번호 npm run seed:admin
 *
 * 계정 정보는 반드시 환경변수로 넘긴다 — 소스에 비밀번호를 남기지 않기 위해서다.
 * PowerShell: $env:ADMIN_ID="..."; $env:ADMIN_PW="..."; npm run seed:admin
 *
 * 비밀번호는 평문으로 두지 않고 scrypt 해시로 저장한다.
 * 로그인 쿠키에 서명할 비밀키(sessionSecret)도 같은 컬렉션에 한 번만 만들어 둔다.
 */
import { readFileSync } from "node:fs";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CREDENTIALS = resolve(ROOT, "atlas-credentials.env");
const DB_NAME = process.env.MONGODB_DB || "nonhyun";
const COLLECTION = "admins";

const ADMIN_ID = process.env.ADMIN_ID;
const ADMIN_PW = process.env.ADMIN_PW;

if (!ADMIN_ID || !ADMIN_PW) {
  console.error("ADMIN_ID 와 ADMIN_PW 환경변수가 필요합니다.");
  console.error('  PowerShell: $env:ADMIN_ID="아이디"; $env:ADMIN_PW="비밀번호"; npm run seed:admin');
  process.exit(1);
}

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

const salt = randomBytes(16).toString("hex");
const hash = scryptSync(ADMIN_PW, salt, 64).toString("hex");

const client = new MongoClient(uri(), { serverSelectionTimeoutMS: 15000 });

try {
  await client.connect();
  const col = client.db(DB_NAME).collection(COLLECTION);

  await col.replaceOne(
    { _id: `user:${ADMIN_ID}` },
    { _id: `user:${ADMIN_ID}`, kind: "user", username: ADMIN_ID, algo: "scrypt", salt, hash },
    { upsert: true },
  );

  // 쿠키 서명키는 한 번 만들면 그대로 둔다 — 바뀌면 로그인된 사람이 전부 튕긴다
  const existing = await col.findOne({ _id: "meta:session" });
  if (!existing) {
    await col.insertOne({
      _id: "meta:session",
      kind: "meta",
      sessionSecret: randomBytes(32).toString("hex"),
    });
  }

  // 방금 넣은 해시로 실제 로그인이 되는지 확인한다
  const saved = await col.findOne({ _id: `user:${ADMIN_ID}` });
  const check = scryptSync(ADMIN_PW, saved.salt, 64);
  const ok = timingSafeEqual(check, Buffer.from(saved.hash, "hex"));

  console.log(`${DB_NAME}.${COLLECTION}: 계정 "${ADMIN_ID}" 저장 · 검증 ${ok ? "성공" : "실패"}`);
  console.log(`쿠키 서명키 ${existing ? "유지" : "생성"}`);
} finally {
  await client.close();
}
