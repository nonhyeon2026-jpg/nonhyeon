import type { BlockConsent } from "@/lib/blocks";

/** 블록 동의율 표시의 크기 (px). 지도 마커의 기준점을 가운데 맞추려면 고정 크기여야 한다 */
const ROW_H = 16;
const ROW_GAP = 2;
export const BLOCK_BADGE_W = 40;
/** 고른 줄 수에 따른 표시 높이 */
export const blockBadgeH = (rows: number) => ROW_H * rows + ROW_GAP * Math.max(0, rows - 1);

/**
 * 세 줄의 색과 막대 기준. 줄마다 색을 고정해 무슨 숫자인지 가르고,
 * 상자 안을 막대처럼 채워 수치가 높은지 낮은지를 드러낸다 — full 에 닿으면 꽉 찬다.
 * 동의율은 사업 요건(면적 1/2, 소유자 2/3)을, 동의자 수는 블록 최대치에 가까운 30명을 기준으로 삼는다.
 */
export const BLOCK_BADGE_ROWS = [
  { key: "area", label: "면적 동의율", button: "면적동의%", color: "#15803d", full: 50, fullText: "1/2" },
  { key: "owner", label: "소유자 동의율", button: "소유동의%", color: "#2563eb", full: 200 / 3, fullText: "2/3" },
  { key: "people", label: "동의자 수", button: "동의자수", color: "#b45309", full: 30, fullText: "30명" },
] as const;

export type BlockRowKey = (typeof BLOCK_BADGE_ROWS)[number]["key"];
export const BLOCK_ROW_KEYS: BlockRowKey[] = BLOCK_BADGE_ROWS.map((r) => r.key);

/** 채운 만큼만 줄 색, 나머지는 어두운 바탕 — 막대 그래프처럼 읽힌다 */
function barBg(color: string, t: number): string {
  const p = Math.round(Math.max(0, Math.min(1, t)) * 100);
  return `linear-gradient(90deg,${color} 0 ${p}%,#1e293b ${p}% 100%)`;
}

const pctText = (r: number) => (Number.isInteger(r) ? `${r}%` : `${r.toFixed(1)}%`);

/**
 * 블록의 면적 동의율·소유자 동의율·동의자 수를 줄마다 띄우는 표시 (위에서부터 차례로).
 * 블록별 버튼 아래의 단추로 고른 줄(rows)만 보여준다.
 * 줄마다 따로 끝이 둥근 상자를 두고 색을 달리하며, 상자를 수치만큼 채워 높낮이를 한눈에 보이게 한다.
 *
 * 네이버 마커와 Leaflet divIcon 이 모두 HTML 문자열을 받아 같은 모양을 쓴다.
 * 필지 색 위에 얹히므로 흰 테두리와 그림자로 바닥과 떼어 놓는다.
 * 동의율은 요건 경계(1/2, 2/3)가 딱 정해져 있어 소수점 한 자리까지 그대로 보여준다.
 */
export function blockBadgeHtml(
  b: Pick<BlockConsent, "areaRatio" | "ownerRatio" | "people">,
  show: readonly BlockRowKey[] = BLOCK_ROW_KEYS,
): string {
  const values = { area: b.areaRatio, owner: b.ownerRatio, people: b.people };
  const picked = BLOCK_BADGE_ROWS.filter((r) => show.includes(r.key));
  const rows = picked.map((r) => {
    const v = values[r.key];
    const text = r.key === "people" ? `${v.toLocaleString()}명` : pctText(v);
    return (
      `<div style="box-sizing:border-box;height:${ROW_H}px;border-radius:4px;` +
      `background:${barBg(r.color, v / r.full)};border:1px solid #fff;` +
      `box-shadow:0 0 0 1px rgba(15,23,42,.5),0 1px 3px rgba(0,0,0,.4);` +
      `display:flex;align-items:center;justify-content:center;` +
      `font-size:${text.length > 4 ? 10.5 : 11}px;font-weight:700">${text}</div>`
    );
  }).join("");
  return (
    `<div style="box-sizing:border-box;width:${BLOCK_BADGE_W}px;height:${blockBadgeH(picked.length)}px;` +
    `display:flex;flex-direction:column;gap:${ROW_GAP}px;line-height:1;` +
    `cursor:pointer;color:#fff;font-family:Pretendard,system-ui,sans-serif;` +
    `letter-spacing:-.04em;text-shadow:0 1px 1px rgba(0,0,0,.6);white-space:nowrap;user-select:none">` +
    rows +
    `</div>`
  );
}
