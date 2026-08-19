/**
 * 지번별 참여의향서 제출 명부(nonhyun.xlsx) → lib/consent.json
 *
 *   npm run import:consent
 *
 * 엑셀은 A:순번 / B:토지등 물건의 주소 / C:호수 3열이고,
 * 같은 지번의 여러 호는 B열이 병합되어 첫 행에만 지번이 들어 있다.
 * C열의 "-" 는 통건물 소유자가 낸 것이라, 그 필지가 여러 세대여도 전 호가 제출한 것으로 본다.
 *
 * 총 호수는 건축물대장 표제부의 호수/세대수/가구수 중 가장 큰 값을 쓴다.
 * 대장에 0 으로만 들어 있는 일반건축물은 총 1호로 본다.
 * 명부에 적힌 호가 대장 값보다 많으면 명부 쪽을 총 호수로 삼는다.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const XLSX_PATH = resolve(ROOT, "nonhyun.xlsx");
const PARCELS_PATH = resolve(ROOT, "public/parcels.json");
const CACHE_PATH = resolve(ROOT, "data/bldrgst-cache.json");
const OUT_PATH = resolve(ROOT, "lib/consent.json");

/* ------------------------------ xlsx 읽기 ------------------------------ */

/** 의존성 없이 zip 로컬 헤더를 훑어 필요한 XML 만 꺼낸다. */
function unzip(path) {
  const buf = readFileSync(path);
  const files = {};
  for (let i = 0; i < buf.length - 4; i++) {
    if (buf.readUInt32LE(i) !== 0x04034b50) continue;
    const method = buf.readUInt16LE(i + 8);
    const compressed = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    const name = buf.toString("utf8", i + 30, i + 30 + nameLen);
    const start = i + 30 + nameLen + extraLen;
    const raw = buf.subarray(start, start + compressed);
    files[name] = (method === 8 ? inflateRawSync(raw) : raw).toString("utf8");
  }
  return files;
}

const decode = (s) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/&amp;/g, "&");

const text = (xml) =>
  decode([...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(""));

/** 시트를 [{A,B,C}, …] 형태의 행 배열로 만든다. 빈 셀은 키가 없다. */
function readSheet(files) {
  const shared = [...(files["xl/sharedStrings.xml"] ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map(
    (m) => text(m[1]),
  );
  const sheet = files["xl/worksheets/sheet1.xml"];
  const rows = [];
  for (const rm of sheet.matchAll(/<row[^>]*\br="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = {};
    for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const inner = cm[2] ?? "";
      const col = (attrs.match(/r="([A-Z]+)\d+"/) ?? [])[1];
      const type = (attrs.match(/t="([^"]+)"/) ?? [])[1];
      let value = (inner.match(/<v>([\s\S]*?)<\/v>/) ?? [])[1];
      if (value === undefined) {
        const is = inner.match(/<is>([\s\S]*?)<\/is>/);
        if (is) value = text(is[1]);
      }
      if (value === undefined || value === "") continue;
      cells[col] = (type === "s" ? shared[+value] : decode(String(value))).trim();
    }
    rows.push({ row: +rm[1], cells });
  }
  return rows;
}

/* ------------------------------ 지번 정규화 ------------------------------ */

/**
 * "논현동 138-3", "194-23 꿈에그린 2차", "205-2" 등에서 본번/부번을 뽑는다.
 * 지번 뒤에 붙은 건물명은 라벨로만 쓴다.
 */
function parseAddress(raw) {
  const m = raw.match(/(?:^|\s)(\d+)(?:\s*-\s*(\d+))?/);
  if (!m) return null;
  const bonbun = Number(m[1]);
  const bubun = Number(m[2] ?? 0);
  return { bonbun, bubun, jibun: bubun ? `${bonbun}-${bubun}` : `${bonbun}` };
}

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

const rows = readSheet(unzip(XLSX_PATH));
const parcels = JSON.parse(readFileSync(PARCELS_PATH, "utf8"));
const cache = JSON.parse(readFileSync(CACHE_PATH, "utf8"));

/** jibun → 필지 */
const byJibun = new Map();
for (const f of parcels.features) byJibun.set(f.properties.jibun, f.properties);

const entries = new Map(); // key: 원본 주소 문자열
let current = null;
for (const { row, cells } of rows) {
  if (row === 1) continue; // 머리글
  if (cells.B) current = cells.B;
  if (!current || cells.C === undefined) continue;
  if (!entries.has(current)) entries.set(current, []);
  entries.get(current).push(cells.C);
}

const out = {};
const unmatched = [];

for (const [label, units] of entries) {
  const parsed = parseAddress(label);
  if (!parsed) {
    unmatched.push(label);
    continue;
  }
  const parcel = byJibun.get(parsed.jibun);
  if (!parcel) {
    unmatched.push(label);
    continue;
  }

  // 같은 지번이 명부에 두 줄로 나뉘어 나오는 경우(예: 205-2, 205-2 꿈에그린1차) 합친다.
  const prev = out[parcel.pnu];
  const merged = prev ? [...prev.units, ...units] : units;

  // "-" 는 통건물 소유자의 제출이다. 호 목록에는 남기지 않고, 그 필지 전 호를 제출로 센다.
  const named = merged.filter((u) => u !== "-");
  const wholeBuilding = merged.length > named.length;

  const registered = totalUnitsFromRegister(cache[parcel.pnu]);
  const total = wholeBuilding
    ? (registered ?? 1)
    : Math.max(named.length, registered ?? 1);
  const submitted = wholeBuilding ? total : named.length;

  out[parcel.pnu] = {
    pnu: parcel.pnu,
    jibun: parcel.jibun,
    label: prev ? prev.label : label,
    total,
    submitted,
    units: named,
    /** 통건물 소유자가 제출해 전 호가 동의한 필지 */
    wholeBuilding,
    /** 총 호수를 대장에서 못 구해 제출 호수로 갈음했는지 */
    totalEstimated: registered === null || registered < submitted,
  };
}

writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");

const list = Object.values(out);
console.log(`명부 지번 ${entries.size}건 → 필지 ${list.length}건 매칭`);
console.log(`제출 호수 합계 ${list.reduce((a, b) => a + b.submitted, 0)}호 / 총 ${list.reduce((a, b) => a + b.total, 0)}호`);
if (unmatched.length) console.log(`매칭 실패 ${unmatched.length}건:`, unmatched);
console.log(`→ ${OUT_PATH}`);
