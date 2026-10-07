import { consentColor } from "@/lib/consent";

/** 블록 동의율 원의 지름 (px) */
export const BLOCK_BADGE_SIZE = 44;

/**
 * 블록 면적 동의율을 지도 위에 띄우는 원.
 *
 * 네이버 마커와 Leaflet divIcon 이 모두 HTML 문자열을 받아 같은 모양을 쓴다.
 * 필지 색 위에 얹히므로 흰 테두리와 그림자로 바닥과 떼어 놓는다.
 * 면적 요건은 경계가 딱 정해져 있어 소수점 한 자리까지 그대로 보여준다.
 */
export function blockBadgeHtml(ratio: number): string {
  const s = BLOCK_BADGE_SIZE;
  const text = Number.isInteger(ratio) ? `${ratio}%` : `${ratio.toFixed(1)}%`;
  return (
    `<div style="width:${s}px;height:${s}px;border-radius:9999px;` +
    `background:${consentColor(ratio)};border:2.5px solid #fff;` +
    `box-shadow:0 0 0 1px rgba(15,23,42,.55),0 2px 6px rgba(0,0,0,.5);` +
    `display:flex;align-items:center;justify-content:center;cursor:pointer;` +
    `color:#fff;font:700 ${text.length > 4 ? 11 : 12}px/1 Pretendard,system-ui,sans-serif;` +
    `letter-spacing:-.02em;text-shadow:0 1px 2px rgba(0,0,0,.6);user-select:none">` +
    `${text}</div>`
  );
}
