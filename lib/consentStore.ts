import { expandShared } from "./consent";
import type { ConsentMap } from "./consent";
import { CONSENT_COLLECTION, mongoDb } from "./mongo";
import type { ConsentInfo, ConsentInput } from "./types";

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

  // 딸림 지번(sharedPnus)에도 대표 문서를 걸어 준다 — lib/consent.ts 참고
  return expandShared(docs as ConsentInfo[]);
}

/**
 * 입력값을 저장 가능한 문서로 다듬는다.
 *
 * 제출 호수는 따로 받지 않고 가능하면 계산한다 — 호 목록이나 통건물 여부와
 * 어긋난 숫자가 저장되면 지도 색과 명부 내용이 서로 다른 말을 하게 된다.
 * 호 목록도 없고 통건물도 아닐 때만 입력한 숫자를 쓴다 (호 구분 없는 명부).
 */
export function normalizeConsent(pnu: string, jibun: string, input: ConsentInput): ConsentInfo {
  const units = (input.units ?? [])
    .map((u) => String(u).trim())
    .filter((u) => u && u !== "-");
  const unique = [...new Set(units)];
  const wholeBuilding = Boolean(input.wholeBuilding);

  // 자기 자신과 중복은 걸러낸다. 한 필지가 두 건물에 걸칠 수는 없다
  const sharedPnus = [
    ...new Set((input.sharedPnus ?? []).map((p) => String(p).trim()).filter(Boolean)),
  ].filter((p) => p !== pnu);

  const total = Math.max(1, Math.round(Number(input.total) || 1));
  const submitted = wholeBuilding
    ? total
    : unique.length
      ? Math.min(unique.length, total)
      : Math.max(0, Math.min(Math.round(Number(input.submitted) || 0), total));

  return {
    pnu,
    jibun,
    label: String(input.label ?? "").trim() || `논현동 ${jibun}`,
    total,
    submitted,
    units: unique,
    wholeBuilding,
    totalEstimated: Boolean(input.totalEstimated),
    sharedPnus,
  };
}

/**
 * 지번 하나의 참여의향서 정보를 새로 넣거나 고친다.
 *
 * 딸림 지번은 자기 명부를 가질 수 없다 — 그러면 같은 건물이 두 번 세어진다.
 * 다른 문서가 물고 있던 딸림 지번은 자동으로 놓게 하고(구역 편입과 같은 규칙),
 * 이미 제 명부가 있는 지번을 딸림으로 넣으려 하면 막는다.
 */
export async function saveConsent(doc: ConsentInfo): Promise<ConsentInfo> {
  const db = await mongoDb();
  const col = db.collection<ConsentInfo & { _id: string }>(CONSENT_COLLECTION);

  const shared = doc.sharedPnus ?? [];
  if (shared.length) {
    const owned = await col.find({ pnu: { $in: shared } }, { projection: { jibun: 1 } }).toArray();
    if (owned.length) {
      const list = owned.map((d) => `논현동 ${d.jibun}`).join(", ");
      throw new Error(
        `${list} 에 이미 별도 명부가 있습니다. 먼저 그 지번을 명부에서 뺀 뒤 같은 건물로 묶어 주세요.`,
      );
    }
    await col.updateMany(
      { _id: { $ne: doc.pnu }, sharedPnus: { $in: shared } },
      { $pull: { sharedPnus: { $in: shared } } },
    );
  }

  await col.updateOne({ _id: doc.pnu }, { $set: { ...doc, _id: doc.pnu } }, { upsert: true });
  return doc;
}

/** 명부에서 지번을 아예 뺀다 (제출 0호로 되돌린다) */
export async function deleteConsent(pnu: string): Promise<void> {
  const db = await mongoDb();
  const col = db.collection<ConsentInfo & { _id: string }>(CONSENT_COLLECTION);
  await col.deleteMany({ pnu });
  // 이 지번을 딸림으로 물고 있던 문서에서도 뗀다 (없는 지번을 가리키지 않게)
  await col.updateMany({ sharedPnus: pnu }, { $pull: { sharedPnus: pnu } });
}
