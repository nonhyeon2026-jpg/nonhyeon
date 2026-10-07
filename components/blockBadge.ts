import { consentColor } from "@/lib/consent";

/** 블록 동의율 표시의 크기 (px). 지도 마커의 기준점을 가운데 맞추려면 고정 크기여야 한다 */
export const BLOCK_BADGE_W = 38;
export const BLOCK_BADGE_H = 28;

/**
 * 블록 면적 동의율과 제출 인원을 지도 위에 띄우는 끝이 둥근 사각형.
 * 윗줄은 면적 동의율, 아랫줄은 제출 인원이다.
 *
 * 네이버 마커와 Leaflet divIcon 이 모두 HTML 문자열을 받아 같은 모양을 쓴다.
 * 필지 색 위에 얹히므로 흰 테두리와 그림자로 바닥과 떼어 놓는다.
 * 면적 요건은 경계가 딱 정해져 있어 소수점 한 자리까지 그대로 보여준다.
 */
export function blockBadgeHtml(ratio: number, people: number): string {
  const text = Number.isInteger(ratio) ? `${ratio}%` : `${ratio.toFixed(1)}%`;
  return (
    `<div style="box-sizing:border-box;width:${BLOCK_BADGE_W}px;height:${BLOCK_BADGE_H}px;` +
    `border-radius:6px;background:${consentColor(ratio)};border:1.5px solid #fff;` +
    `box-shadow:0 0 0 1px rgba(15,23,42,.5),0 1px 4px rgba(0,0,0,.45);` +
    `display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;` +
    `cursor:pointer;color:#fff;font-family:Pretendard,system-ui,sans-serif;` +
    `letter-spacing:-.03em;text-shadow:0 1px 1px rgba(0,0,0,.6);white-space:nowrap;user-select:none">` +
    `<span style="font-size:${text.length > 4 ? 9.5 : 10}px;font-weight:700;line-height:1">${text}</span>` +
    `<span style="font-size:8.5px;font-weight:600;line-height:1;opacity:.9">${people.toLocaleString()}명</span>` +
    `</div>`
  );
}
