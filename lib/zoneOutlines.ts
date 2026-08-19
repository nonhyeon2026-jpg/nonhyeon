import raw from "@/data/zone-outlines.json";

/** 구역 경계 — 구역 전체를 감싸는 닫힌 윤곽. scripts/gen-zone-outlines.mjs 가 만든다. */
export type ZoneOutline = {
  zoneId: string;
  name: string;
  color: string;
  /** [lng, lat] 로 이뤄진 닫힌 링. 첫 점과 끝 점이 같다 */
  paths: [number, number][][];
};

export const ZONE_OUTLINES: Record<string, ZoneOutline> = raw as unknown as Record<
  string,
  ZoneOutline
>;
