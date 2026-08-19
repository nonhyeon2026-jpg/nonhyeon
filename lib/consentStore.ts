import type { ConsentMap } from "./consent";
import { CONSENT_COLLECTION, mongoDb } from "./mongo";
import type { ConsentInfo } from "./types";

/**
 * MongoDB 에서 참여의향서 명부를 읽어 pnu 를 키로 하는 맵으로 만든다.
 * 서버 전용 — 접속 문자열이 클라이언트로 넘어가면 안 된다.
 */
export async function readConsent(): Promise<ConsentMap> {
  const db = await mongoDb();
  const docs = await db
    .collection<ConsentInfo & { _id: string }>(CONSENT_COLLECTION)
    .find({}, { projection: { _id: 0 } })
    .toArray();

  const map: ConsentMap = {};
  for (const doc of docs) map[doc.pnu] = doc as ConsentInfo;
  return map;
}
