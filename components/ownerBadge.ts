import type { OwnerBasis, OwnerTone } from "@/lib/consent";

/** 지도에 띄우는 필지별 추정 소유자 한 건 */
export type OwnerMark = OwnerBasis & {
  pnu: string;
  jibun: string;
  /** 표시를 앉힐 자리 [lat, lng] — 필지 한가운데 */
  anchor: [number, number];
};

/** 소유자 수 표시의 높이 (px). 폭은 자릿수에 따라 ownerBadgeWidth 로 정한다 */
export const OWNER_BADGE_H = 18;

/** 지도 마커의 기준점을 가운데 맞추려면 크기를 미리 알아야 한다 */
export const ownerBadgeWidth = (owners: number) => 12 + 6.5 * String(owners).length;

/**
 * 성격별 바탕색. 블록 동의율(연두~초록)과 겹치지 않는 색으로 고른다.
 * 통건물은 파랑, 일부 묶음은 보라, 확인 필요는 주황, 한 땅의 여러 동은 청록으로 눈에 띄게 하고
 * 호마다 따로·일반건축물처럼 흔한 것은 무채색으로 가라앉힌다.
 */
const TONE_BG: Record<OwnerTone, string> = {
  whole: "#2563eb",
  grouped: "#7c3aed",
  check: "#d97706",
  shared: "#0d9488",
  units: "#334155",
  single: "#475569",
  none: "#1e293b",
};

/** 범례에서도 같은 색을 쓴다 */
export const OWNER_TONE_LEGEND: { tone: OwnerTone; label: string; color: string }[] = [
  { tone: "whole", label: "통건물", color: TONE_BG.whole },
  { tone: "grouped", label: "일부 묶음", color: TONE_BG.grouped },
  { tone: "check", label: "확인 필요", color: TONE_BG.check },
  { tone: "shared", label: "여러 동", color: TONE_BG.shared },
  { tone: "units", label: "집합건물", color: TONE_BG.units },
  { tone: "single", label: "단독·다가구·근생", color: TONE_BG.single },
  { tone: "none", label: "다른 지번에서 셈", color: TONE_BG.none },
];

/**
 * 필지의 추정 소유자 수를 띄우는 작은 알약.
 * 네이버 마커와 Leaflet divIcon 이 모두 HTML 문자열을 받아 같은 모양을 쓴다.
 */
export function ownerBadgeHtml(owners: number, tone: OwnerTone): string {
  const w = ownerBadgeWidth(owners);
  return (
    `<div style="box-sizing:border-box;width:${w}px;height:${OWNER_BADGE_H}px;` +
    `border-radius:${OWNER_BADGE_H / 2}px;background:${TONE_BG[tone]};` +
    `border:1.5px solid rgba(255,255,255,.85);` +
    `box-shadow:0 1px 3px rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;` +
    `cursor:pointer;color:#fff;font:700 10.5px/1 Pretendard,system-ui,sans-serif;` +
    `letter-spacing:-.02em;white-space:nowrap;user-select:none">${owners}</div>`
  );
}
