/**
 * 지번별 참여의향서 제출 명부(xlsx) → lib/consent.json
 *
 *   npm run import:consent                       # nonhyun.xlsx
 *   npm run import:consent -- "의향서 제출 최신본.xlsx"
 *
 * 명부 읽기는 scripts/roster.mjs 가 한다 (성명 열이 있는 꼴과 없는 꼴 모두).
 * C열의 "-" 는 통건물 소유자가 낸 것이라, 그 필지가 여러 세대여도 전 호가 제출한 것으로 본다.
 *
 * 총 호수는 건축물대장 표제부의 호수/세대수/가구수 중 가장 큰 값을 쓴다.
 * 대장에 0 으로만 들어 있는 일반건축물은 총 1호로 본다.
 * 명부에 적힌 호가 대장 값보다 많으면 명부 쪽을 총 호수로 삼는다.
 *
 * 주의: migrate:consent 는 DB 를 이 파일로 통째로 갈아 끼운다 — 관리자 화면에서 고친 값이
 * 사라진다. 이미 DB 를 쓰고 있으면 새 명부는 merge:consent 로 보강한다.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readRoster } from "./roster.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const XLSX_PATH = resolve(ROOT, process.argv[2] ?? "nonhyun.xlsx");
const PARCELS_PATH = resolve(ROOT, "public/parcels.json");
const CACHE_PATH = resolve(ROOT, "data/bldrgst-cache.json");
const OUT_PATH = resolve(ROOT, "lib/consent.json");

/* ------------------------------ 총 호수 ------------------------------ */

/** 건축물대장 표제부(동별)에서 이 필지의 총 호수를 추정한다. */
function totalUnitsFromRegister(records) {
  if (!records?.length) return null;
  let total = 0;
  for (const r of records) {
    const units = Math.max(Number(r.hoCnt) || 0, Number(r.hhldCnt) || 0, Number(r.fmlyCnt) || 0);
    total += units || 1; // 대장에 호/세대/가구가 0 이면 동 자체를 1호로 본다
  }
  return total;
}

/* ------------------------------ 본체 ------------------------------ */

const roster = readRoster(XLSX_PATH);
const parcels = JSON.parse(readFileSync(PARCELS_PATH, "utf8"));
const cache = JSON.parse(readFileSync(CACHE_PATH, "utf8"));

/** jibun → 필지 */
const byJibun = new Map();
for (const f of parcels.features) byJibun.set(f.properties.jibun, f.properties);

const out = {};
const unmatched = [];

for (const [jibun, e] of roster) {
  const parcel = byJibun.get(jibun);
  if (!parcel) {
    unmatched.push(e.label);
    continue;
  }

  // "-" 는 통건물 소유자의 제출이다. 호 목록에는 남기지 않고, 그 필지 전 호를 제출로 센다.
  const named = [...new Set(e.units)];
  const wholeBuilding = e.whole;

  const registered = totalUnitsFromRegister(cache[parcel.pnu]);
  const total = wholeBuilding
    ? (registered ?? 1)
    : Math.max(named.length, registered ?? 1);
  const submitted = wholeBuilding ? total : named.length;

  out[parcel.pnu] = {
    pnu: parcel.pnu,
    jibun: parcel.jibun,
    label: e.label,
    total,
    submitted,
    units: named,
    /** 통건물 소유자가 제출해 전 호가 동의한 필지 */
    wholeBuilding,
    /** 총 호수를 대장에서 못 구해 제출 호수로 갈음했는지 */
    totalEstimated: registered === null || registered < submitted,
    /** 한 사람이 함께 낸 호 묶음 (2호 이상) */
    unitGroups: wholeBuilding ? [] : e.people.map((p) => [...new Set(p)]).filter((p) => p.length > 1),
  };
}

writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");

const list = Object.values(out);
console.log(`명부 지번 ${roster.size}건 → 필지 ${list.length}건 매칭`);
console.log(`제출 호수 합계 ${list.reduce((a, b) => a + b.submitted, 0)}호 / 총 ${list.reduce((a, b) => a + b.total, 0)}호`);
if (unmatched.length) console.log(`매칭 실패 ${unmatched.length}건:`, unmatched);
console.log(`→ ${OUT_PATH}`);
