import { headers } from "next/headers";
import { HISTORY_COLLECTION, mongoDb } from "./mongo";
import type { ConsentInfo, HistoryEntry } from "./types";

/**
 * 구역·명부 변경 기록 (nonhyun.history).
 *
 * 구역 필지가 두 번이나 누가 뺐는지 모르게 빠졌다(138·139번지). 관리자 계정이 하나라
 * 아이디만으로는 사람을 가릴 수 없어 접속 IP 와 브라우저(User-Agent)도 함께 남긴다.
 * 기록은 쓰기 요청이 성공한 뒤에 남기고, 기록이 실패해도 본 작업은 되돌리지 않는다.
 */

/** 화면에 내려 줄 최근 기록 수 */
const RECENT = 200;

function client() {
  const h = headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "";
  return { ip, agent: h.get("user-agent") ?? "" };
}

export async function recordHistory(
  user: string,
  entry: Omit<HistoryEntry, "id" | "at" | "user" | "ip" | "agent">,
): Promise<void> {
  try {
    const db = await mongoDb();
    await db.collection(HISTORY_COLLECTION).insertOne({ at: new Date(), user, ...client(), ...entry });
  } catch (e) {
    console.error("변경 기록을 남기지 못했습니다", e);
  }
}

export async function readHistory(): Promise<HistoryEntry[]> {
  const db = await mongoDb();
  const docs = await db.collection(HISTORY_COLLECTION).find({}).sort({ at: -1 }).limit(RECENT).toArray();
  return docs.map(({ _id, at, ...rest }) => ({
    ...(rest as Omit<HistoryEntry, "id" | "at">),
    id: String(_id),
    at: (at as Date).toISOString(),
  }));
}

/** 명부 한 건을 기록에 담을 만큼만 줄인다 */
export const consentBrief = (c: ConsentInfo | null | undefined) =>
  c
    ? {
        submitted: c.submitted,
        total: c.total,
        wholeBuilding: c.wholeBuilding,
        units: c.units,
      }
    : null;
