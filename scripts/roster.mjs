/**
 * 참여의향서 제출 명부(xlsx) 읽기. import-consent.mjs 와 merge-consent.mjs 가 같이 쓴다.
 *
 * 명부는 두 가지 꼴이 있다.
 *   nonhyun.xlsx              A:순번 / B:토지등 물건의 주소 / C:호수
 *   의향서 제출 최신본.xlsx   A:순번 / B:성명 / C:토지등 물건의 주소 / D:호수
 * 머리글 줄에서 "주소" 열을 찾고, 호수는 그 오른쪽 열(머리글이 비어 있다)로 본다.
 * 같은 지번의 여러 호는 주소 열이 병합되어 첫 행에만 지번이 들어 있다.
 *
 * 성명은 한 사람이 낸 호를 묶는 데만 쓰고 밖으로 내보내지 않는다 (개인정보).
 */
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

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

/** 시트를 [{row, cells: {A,B,C}}, …] 형태의 행 배열로 만든다. 빈 셀은 키가 없다. */
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

const nextCol = (col) => String.fromCharCode(col.charCodeAt(0) + 1);

/* ------------------------------ 지번 · 호 ------------------------------ */

/**
 * "논현동 138-3", "194-23 꿈에그린 2차", "205-2" 등에서 본번/부번을 뽑는다.
 * 지번 뒤에 붙은 건물명은 라벨로만 쓴다.
 */
export function parseAddress(raw) {
  const m = raw.match(/(?:^|\s)(\d+)(?:\s*-\s*(\d+))?/);
  if (!m) return null;
  const bonbun = Number(m[1]);
  const bubun = Number(m[2] ?? 0);
  return { bonbun, bubun, jibun: bubun ? `${bonbun}-${bubun}` : `${bonbun}` };
}

/**
 * 한 칸에 여러 호를 적은 것("606, 1105호", "B1, B2, 201호")을 나눈다.
 * 끝에만 "호" 를 붙인 꼴이면 앞의 호에도 붙여 표기를 맞춘다.
 * "101~401(총 11호)" 처럼 나눌 수 없는 표기는 그대로 둔다.
 */
export function splitUnits(cell) {
  const parts = cell.split(/\s*,\s*/).filter(Boolean);
  if (parts.length < 2 || !parts.every((p) => /^[A-Za-z]?\d+호?$/.test(p))) return [cell];
  const suffix = parts[parts.length - 1].endsWith("호");
  return parts.map((p) => (suffix && /^\d+$/.test(p) ? `${p}호` : p));
}

/** 호 표기를 견줄 때 쓰는 열쇠: 괄호 설명·공백·"제"·끝의 "호" 를 뗀다 */
export const unitKey = (u) =>
  u
    .replace(/\([^)]*\)/g, "")
    .replace(/\s/g, "")
    .replace(/제/g, "")
    .replace(/호$/, "")
    .toUpperCase();

/**
 * 호 목록(have)에서 u 와 같은 호를 찾는다.
 * 열쇠가 같거나, 한쪽이 동·층을 앞에 더 적은 꼴("B동 304호" ↔ "304호",
 * "제1동 제1층 제104호" ↔ "104호")이면 같은 호로 본다.
 */
export function findUnit(have, u) {
  const k = unitKey(u);
  const exact = have.find((h) => unitKey(h) === k);
  if (exact) return exact;
  return have.find((h) => {
    const hk = unitKey(h);
    const [long, short] = hk.length > k.length ? [hk, k] : [k, hk];
    return short.length >= 3 && long.endsWith(short) && /[동층]$/.test(long.slice(0, -short.length));
  });
}

/* ------------------------------ 명부 ------------------------------ */

/**
 * 명부를 지번별로 묶는다.
 * 돌려주는 값: Map<jibun, { label, whole, units, people }>
 *   whole  — 통건물 소유자 제출("-")이 있는지
 *   units  — 나눈 호 목록 (중복 제거 전, 명부 순서)
 *   people — 한 사람이 낸 호 목록의 배열. 성명이 없는 옛 명부는 한 줄을 한 사람으로 본다.
 *            같은 지번에 같은 이름(공백 무시)이 두 줄 이상이면 한 사람이다.
 */
export function readRoster(path) {
  const rows = readSheet(unzip(path));
  const head = rows.find((r) => Object.values(r.cells).some((v) => v.includes("주소")));
  if (!head) throw new Error(`${path}: "주소" 머리글을 찾지 못했습니다`);
  const col = (word) => Object.keys(head.cells).find((k) => head.cells[k].includes(word));
  const addrCol = col("주소");
  const unitCol = nextCol(addrCol);
  const nameCol = col("성명");

  const out = new Map();
  let current = null;
  for (const { row, cells } of rows) {
    if (row <= head.row) continue;
    if (cells[addrCol]) current = cells[addrCol];
    const cell = cells[unitCol];
    if (!current || cell === undefined) continue;
    const parsed = parseAddress(current);
    const key = parsed?.jibun ?? `?${current}`;
    if (!out.has(key)) out.set(key, { label: current, labels: [current], whole: false, units: [], byName: new Map(), people: [] });
    const e = out.get(key);
    // 같은 지번이 명부에 두 줄로 나뉘어 나오는 경우(205-2 꿈에그린1차 101동·102동) 합친다
    if (!e.labels.includes(current)) e.labels.push(current);
    if (cell === "-") {
      e.whole = true;
      continue;
    }
    const units = splitUnits(cell);
    e.units.push(...units);
    const name = nameCol ? (cells[nameCol] ?? "").replace(/\s/g, "") : "";
    const person = name ? e.byName.get(name) : undefined;
    if (person) person.push(...units);
    else {
      const list = [...units];
      e.people.push(list);
      if (name) e.byName.set(name, list);
    }
  }
  for (const e of out.values()) delete e.byName;
  return out;
}

/**
 * 성명이 두 지번 이상에 나오는 경우를 센다 (한 사람이 여러 필지를 가졌을 수 있다).
 * 동명이인과 가릴 수 없어 계산에는 쓰지 않고 확인용으로만 쓴다. 이름은 돌려주지 않는다.
 */
export function namesInManyParcels(path) {
  const rows = readSheet(unzip(path));
  const head = rows.find((r) => Object.values(r.cells).some((v) => v.includes("주소")));
  const col = (word) => Object.keys(head.cells).find((k) => head.cells[k].includes(word));
  const addrCol = col("주소");
  const nameCol = col("성명");
  if (!nameCol) return [];
  const where = new Map();
  let current = null;
  for (const { row, cells } of rows) {
    if (row <= head.row) continue;
    if (cells[addrCol]) current = cells[addrCol];
    const jibun = current && parseAddress(current)?.jibun;
    if (!jibun || !cells[nameCol]) continue;
    for (const n of cells[nameCol].split(/[,/·.]\s*/)) {
      const name = n.trim();
      if (!name) continue;
      if (!where.has(name)) where.set(name, new Set());
      where.get(name).add(jibun);
    }
  }
  return [...where.values()].filter((s) => s.size > 1).map((s) => [...s]);
}
