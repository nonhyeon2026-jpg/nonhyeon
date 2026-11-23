/**
 * 인터넷등기소 열람 텍스트(iros-out/text/<고유번호>.txt) → 현재 소유자 명부(iros-out/소유자명부.csv).
 *
 *   node scripts/iros-owners.mjs
 *
 * 열람 때 "요약"을 체크하면 증명서 끝에 「주요 등기사항 요약」이 붙는다. 그중
 * "1. 소유지분현황 (갑구)" 는 말소되지 않은 소유자·공유자만 가나다 순으로 적고, 한 사람이 여러
 * 순위번호로 가진 지분은 합쳐 준다. 갑구를 처음부터 따라가며 말소를 가릴 필요가 없다.
 *
 * 요약이 없는 텍스트(요약 체크를 빠뜨린 열람)는 "요약 없음"으로 남긴다.
 * 결과에는 이름·주소가 들어간다 (개인정보) — iros-out/ 은 커밋하지 않는다.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TEXT_DIR = resolve(ROOT, "iros-out/text");
const OUT = resolve(ROOT, "iros-out/소유자명부.csv");

// 홍길동 (소유자) 920223-******* 단독소유 서울특별시 … 11
// 주식회사 가나 (소유자) 110111-1234567 2분의 1 서울 … 3, 5
const OWNER =
  /^(?<name>.+?) \((?<role>[^)]+)\) (?:(?<id>\d{6}-[\d*]{7}|\d{3}-\d{2}-\d{5}) )?(?<share>단독소유|\d+분의 ?\d+|확인불가)\s*(?<addr>.*?)\s*(?<rank>\d+(?:[-,] ?\d+)*)?$/;

function section(lines, start, end) {
  const i = lines.findIndex((l) => l.startsWith(start));
  if (i < 0) return null;
  const j = lines.findIndex((l, k) => k > i && end.some((e) => l.startsWith(e)));
  return lines.slice(i + 1, j < 0 ? undefined : j);
}

function parse(pin, text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^=== p\d+ ===$/.test(l));
  const head = lines.find((l) => /^\[(토지|건물|집합건물)\]/.test(l)) || "";
  const kind = head.match(/^\[(.+?)\]/)?.[1] || "";
  const base = { 고유번호: pin, 구분: kind, 부동산표시: head.replace(/^\[.+?\]\s*/, "") };

  const s = lines.findIndex((l) => l.startsWith("주요 등기사항 요약"));
  if (s < 0) return [{ ...base, 비고: "요약 없음 — '요약' 체크 후 다시 열람 필요" }];
  const sum = lines.slice(s);
  const summaryHead = sum.find((l) => /^\[(토지|건물|집합건물)\]/.test(l));
  if (summaryHead) base.부동산표시 = summaryHead.replace(/^\[.+?\]\s*/, "");
  const printed = sum.find((l) => l.startsWith("출력일시"))?.replace(/^출력일시\s*:\s*/, "") || "";

  const own = section(sum, "1. 소유지분현황", ["2. 소유지분을"]) || [];
  const gap = (section(sum, "2. 소유지분을", ["3. "]) || []).filter((l) => !/기록사항 없음/.test(l)).join(" / ");
  const eul = (section(sum, "3. ", ["[ 참 고 사 항 ]"]) || []).filter((l) => !/기록사항 없음/.test(l)).join(" / ");

  const rows = [];
  const notes = [];
  for (const l of own) {
    if (l.startsWith("등기명의인")) continue;
    const m = l.match(OWNER);
    if (m) {
      const g = m.groups;
      rows.push({
        ...base,
        등기명의인: g.name,
        지위: g.role,
        등록번호: g.id || "",
        최종지분: g.share,
        주소: g.addr,
        순위번호: g.rank || "",
      });
    } else if (/공유자 ?전원지분|대지권/.test(l)) {
      notes.push(l);
    } else if (rows.length && !notes.length) {
      rows[rows.length - 1].주소 += " " + l; // 줄바꿈된 주소
    } else {
      notes.push(l);
    }
  }
  let 비고 = notes.join(" ");
  if (/대지권/.test(비고)) {
    비고 = `대지권 설정됨(${비고}) — 땅 소유는 집합건물 호별 등기로 확인. 아래 명의인은 대지권 전 지분일 수 있음`;
  }
  const extra = { "갑구 기타(압류·가처분 등)": gap, "을구 요약(근저당 등)": eul, 출력일시: printed };
  if (!rows.length) return [{ ...base, ...extra, 비고: 비고 || "소유지분현황을 읽지 못함 — 원문 확인" }];
  return rows.map((r) => ({ ...r, ...extra, 비고 }));
}

const COLS = ["고유번호", "구분", "부동산표시", "등기명의인", "지위", "등록번호", "최종지분", "주소", "순위번호",
  "갑구 기타(압류·가처분 등)", "을구 요약(근저당 등)", "비고", "출력일시"];
const csv = (v) => (/[",\n]/.test(v ?? "") ? `"${String(v).replace(/"/g, '""')}"` : (v ?? ""));

const files = readdirSync(TEXT_DIR).filter((f) => f.endsWith(".txt")).sort();
const all = files.flatMap((f) => parse(f.replace(/\.txt$/, ""), readFileSync(resolve(TEXT_DIR, f), "utf8")));
writeFileSync(OUT, "﻿" + [COLS.join(","), ...all.map((r) => COLS.map((c) => csv(r[c])).join(","))].join("\r\n"));
console.log(`${files.length}건 → ${all.length}줄: ${OUT}`);
for (const f of files) {
  const rs = all.filter((r) => r.고유번호 === f.replace(/\.txt$/, ""));
  console.log(`  ${rs[0].고유번호} ${rs[0].구분} 명의인 ${rs.filter((r) => r.등기명의인).length}명${rs[0].비고 ? " · " + rs[0].비고.slice(0, 40) : ""}`);
}
