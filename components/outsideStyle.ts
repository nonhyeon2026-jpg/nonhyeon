import type { ConsentInfo, Zone } from "@/lib/types";

/**
 * 구역 밖 제출 필지의 테두리. 채움은 제출률 색 그대로 두고 테두리만 보라 점선으로 바꿔
 * 구역 필지와 가른다 — 제출률 색 계열(빨강·연두·초록)과 1·2·3종 색(파랑·빨강·주황)에 없는 색이다.
 */
export const OUTSIDE_STROKE = "#a78bfa";

/**
 * 이 필지가 구역 밖 제출인지 (lib/consent.ts 의 outsideConsent 와 같은 기준).
 * 딸림 지번 하나라도 구역에 들면 그 건물은 구역에서 센다.
 */
export const isOutside = (pnu: string, c: ConsentInfo, zoneOf: Map<string, Zone>) =>
  c.submitted > 0 &&
  !zoneOf.has(pnu) &&
  !zoneOf.has(c.pnu) &&
  !(c.sharedPnus ?? []).some((p) => zoneOf.has(p));
