import { readFileSync } from "node:fs";
import path from "node:path";
import { MongoClient, type Db } from "mongodb";

/**
 * MongoDB Atlas 연결. 서버에서만 쓴다 (접속 문자열에 비밀번호가 들어 있다).
 *
 * 접속 정보는 환경변수 MONGODB_URI 를 먼저 보고, 없으면 Atlas 온보딩이 만들어 준
 * atlas-credentials.env 를 직접 읽는다. 이 파일은 Next 가 자동으로 읽어주지 않는다.
 */

const CREDENTIALS_FILE = "atlas-credentials.env";
export const DB_NAME = process.env.MONGODB_DB ?? "nonhyun";
export const CONSENT_COLLECTION = "consent";
export const ZONE_COLLECTION = "zones";
export const ADMIN_COLLECTION = "admins";

/** KEY="value" / KEY=value 형태만 읽는 최소 파서 */
function readEnvFile(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  let text: string;
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

export function mongoUri(): string {
  if (process.env.MONGODB_URI) return process.env.MONGODB_URI;

  const file = readEnvFile(path.join(process.cwd(), CREDENTIALS_FILE));
  const uri = file.MONGODB_URI;
  if (!uri) {
    throw new Error(
      `MongoDB 접속 정보가 없습니다. 환경변수 MONGODB_URI 를 넣거나 ${CREDENTIALS_FILE} 를 프로젝트 루트에 두세요.`,
    );
  }

  // Atlas 가 주는 문자열에는 비밀번호가 <db_password> 자리표시자로 들어 있기도 하다
  if (uri.includes("<db_password>") && file.MONGODB_PASSWORD) {
    return uri.replace("<db_password>", encodeURIComponent(file.MONGODB_PASSWORD));
  }
  return uri;
}

/**
 * 개발 중에는 파일이 바뀔 때마다 모듈이 다시 평가되므로,
 * 전역에 물려두지 않으면 접속이 계속 새로 열린다.
 */
const globalForMongo = globalThis as unknown as { _mongoClient?: Promise<MongoClient> };

export function mongoClient(): Promise<MongoClient> {
  if (!globalForMongo._mongoClient) {
    globalForMongo._mongoClient = new MongoClient(mongoUri(), {
      serverSelectionTimeoutMS: 10000,
    }).connect();
  }
  return globalForMongo._mongoClient;
}

export async function mongoDb(): Promise<Db> {
  return (await mongoClient()).db(DB_NAME);
}
