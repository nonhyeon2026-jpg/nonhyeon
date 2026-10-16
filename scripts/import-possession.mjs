/**
 * VWorld 토지소유정보(getPossessionAttr) → public/parcels.json 의 building.owners · land 병합.
 *
 *   PowerShell: $env:VWORLD_KEY="키"; $env:VWORLD_DOMAIN="도메인"; npm run import:possession
 *
 * 집합건축물 필지만 조회한다. 응답은 대지권을 가진 호마다 한 줄(공유자면 사람마다 한 줄)이고,
 * 이름은 없지만 호별로 소유권 변동 원인과 날짜가 나온다. 이걸로 통건물을 가려낸다.
 *
 * 같은 날 보존등기한 뒤 팔리지 않은 호들, 같은 날 주소·이름을 고친 호들은 한 사람으로 묶는다.
 * 전 호가 하나로 묶이면 통건물이다. 규칙은 estimateOwners 에 있다.
 *
 * 호 행이 하나라도 있으면 그 수를 대장 호수보다 믿는다 — 대장 표제부의 세대·호 칸은
 * 적는 방식이 건물마다 달라 실제 전유 호수와 어긋나는 일이 잦다 (207번지: 대장 54, 실제 108).
 *
 * 응답은 data/possession-cache.json 에 저장해 이어받는다 (호별 변동 내역이라 커밋하지 않는다).
 * 자료 기준월은 응답의 stdrYm 이며 실시간 등기와 다를 수 있다.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PARCELS_PATH = resolve(ROOT, "public/parcels.json");
const CACHE_PATH = resolve(ROOT, "data/possession-cache.json");
/**
 * 토지소유정보 기준월 뒤에 묶인 호가 팔린 필지 (국토부 실거래가로 확인).
 * 법인이 묶여 가진 호를 개인에게 판 거래만 넣는다 — 판 사람이 묶인 그 법인인 게 확실하다.
 * added 는 늘어난 사람 수다. 묶인 호를 다 팔았으면 그 법인이 빠지므로 sold − 1 이다.
 */
const SOLD_PATH = resolve(ROOT, "scripts/possession-sold.json");

const KEY = process.env.VWORLD_KEY;
const DOMAIN = process.env.VWORLD_DOMAIN ?? "http://localhost";
const ENDPOINT = "https://api.vworld.kr/ned/data/getPossessionAttr";
const PAGE = 1000;
const MIN_INTERVAL_MS = 100;

if (!KEY) {
  console.error('VWORLD_KEY 환경변수가 필요합니다. 예: $env:VWORLD_KEY="키"; npm run import:possession');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 필지 하나의 소유 행 전부. 쓰는 필드만 남긴다 */
async function fetchPossession(pnu) {
  const rows = [];
  for (let page = 1; ; page++) {
    const url = new URL(ENDPOINT);
    url.search = new URLSearchParams({
      key: KEY,
      domain: DOMAIN,
      pnu,
      format: "json",
      numOfRows: String(PAGE),
      pageNo: String(page),
    }).toString();
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    if (body.response) throw new Error(`VWorld [${body.response.resultCode}] ${body.response.resultMsg}`);
    const p = body.possessions ?? {};
    for (const r of p.field ?? []) {
      rows.push({
        bld: r.agbldgSn,
        dong: r.buldDongNm,
        ho: r.buldHoNm,
        room: r.buldRoomNm,
        sn: r.cnrsPsnSn,
        kind: r.posesnSeCodeNm,
        cause: r.ownshipChgCauseCodeNm,
        date: r.ownshipChgDe,
        resdnc: r.resdncSeCodeNm,
        ym: r.stdrYm,
      });
    }
    if (rows.length >= Number(p.totalCount ?? 0) || !(p.field ?? []).length) break;
    await sleep(MIN_INTERVAL_MS);
  }
  return rows;
}

/**
 * 소유자가 바뀌지 않고 그 사람 앞으로 남은 기록. 보존등기 그대로이거나, 보존·이전 뒤에
 * 주소·이름만 고친 경우다. 한 건물에서 이런 기록이 같은 날 같은 모양으로 여러 호에 찍혔으면
 * 한 사람이 한꺼번에 한 일로 본다. 소유권이전은 같은 날이어도 묶지 않는다 — 분양은 같은 날
 * 여러 사람에게 넘어가기도 한다.
 */
const SAME_HOLDER_CAUSES = new Set([
  "소유권보존",
  "주소변경",
  "주소경정",
  "성명(명칭)변경",
  "성명(명칭)경정",
  "등록번호경정",
]);

/** 대지권이 붙은 호의 행인지. 대지권 미등기 필지는 동·호가 "0000" 인 토지 행만 나온다 */
const isUnitRow = (r) => r.ho && r.ho !== "0000";

/**
 * 호별 소유 행으로 소유자 수를 어림한다.
 *
 *   - 공유자가 여럿인 호는 1명이다 (동의율 산정에서 공유자는 대표 1인).
 *   - 원인·날짜·개인/법인·거주지 구분이 모두 같은 SAME_HOLDER_CAUSES 호들은 묶어 1명이다.
 *   - 보존 날짜는 같은데 거주지 구분이나 개인/법인이 갈리면 공동건축주가 호를 나눠 가진 것일 수
 *     있다. 갈린 무리마다 1명으로 세고 check 로 표시한다.
 *   - 나머지 호는 호마다 1명이다. 같은 사람이 여러 호를 사들인 경우는 여기서 알 수 없다.
 */
export function estimateOwners(rows) {
  /** 호 키 → 그 호의 대표 행 (공유자 중 가장 앞 일련번호) */
  const units = new Map();
  for (const r of rows) {
    if (!isUnitRow(r)) continue;
    const key = `${r.bld}|${r.dong}|${r.ho}|${r.room}`;
    const prev = units.get(key);
    if (!prev || r.sn < prev.sn) units.set(key, r);
  }

  /** 묶음 키 → 호 수 */
  const groups = new Map();
  let singles = 0;
  for (const r of units.values()) {
    if (!SAME_HOLDER_CAUSES.has(r.cause) || !r.date) {
      singles += 1;
      continue;
    }
    const key = `${r.cause}|${r.date}|${r.kind}|${r.resdnc}`;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }

  // 같은 원인·날짜가 거주지 구분이나 개인/법인으로 갈렸는지
  const byDay = new Map();
  for (const key of groups.keys()) {
    const day = key.split("|").slice(0, 2).join("|");
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  const check = [...byDay.values()].some((n) => n > 1);

  /*
   * 통매입. 전 호가 같은 날 같은 개인/법인에게 넘어갔으면 한 사람이 건물째 산 것이다
   * (155번지: 14호 전부 2014-04-25 이전). 분양은 호마다 날짜가 흩어지므로 이전이라도 묶는다.
   * 거주지 구분이 갈리면 여러 사람이 나눠 샀을 수도 있어 check 로 남긴다.
   */
  const reps = [...units.values()];
  const wholeDay =
    reps.length > 1 &&
    reps.every((r) => r.date && r.cause && r.date === reps[0].date && r.kind === reps[0].kind);
  if (wholeDay) {
    return {
      units: units.size,
      owners: 1,
      grouped: units.size,
      pattern: "whole",
      check: new Set(reps.map((r) => r.resdnc)).size > 1,
      asOf: rows[0]?.ym ?? null,
    };
  }

  const owners = singles + groups.size;
  /** 2호 이상 묶인 호 수 — 한 사람이 여러 호를 가진 것으로 본 호 */
  const grouped = [...groups.values()].filter((n) => n > 1).reduce((a, n) => a + n, 0);

  return {
    /** 대지권이 붙은 호 수 */
    units: units.size,
    /** 추정 소유자 수 */
    owners,
    /** 한 사람 몫으로 묶인 호 수 */
    grouped,
    /**
     * whole: 전 호가 한 사람 (통건물) · partial: 일부 호를 한 사람이 여럿 가짐 · none: 묶인 호 없음
     */
    pattern: units.size > 1 && owners === 1 ? "whole" : grouped ? "partial" : "none",
    /** 공동건축주 의심 — 정부24 열람으로 확인할 필지 */
    check,
    asOf: rows[0]?.ym ?? null,
  };
}

const parcels = JSON.parse(readFileSync(PARCELS_PATH, "utf8"));
const cache = existsSync(CACHE_PATH) ? JSON.parse(readFileSync(CACHE_PATH, "utf8")) : {};

/*
 * 집합건축물뿐 아니라 일반건축물·빈 땅도 받는다. 일반건축물은 호 행 없이 땅 소유자가
 * 사람마다 한 줄씩 나와, 땅을 여럿이 지분으로 나눠 가진 필지를 가려낼 수 있다
 * (153-1: 단독·근생 11개 동이 앉은 땅을 17명이 공유). 지번 없는 관리용 필지는 뺀다.
 */
const targets = parcels.features.filter(
  (f) => f.properties.bonbun > 0 && !(f.properties.pnu in cache),
);
console.log(`조회 대상 ${targets.length}개 (캐시 ${Object.keys(cache).length}개)`);

let done = 0;
let failed = 0;
for (const f of targets) {
  try {
    cache[f.properties.pnu] = await fetchPossession(f.properties.pnu);
  } catch (e) {
    failed += 1;
    console.error(`${f.properties.jibun}: ${e.message}`);
    if (/INCORRECT_KEY|OVER_REQUEST|LIMIT/i.test(e.message)) break;
  }
  done += 1;
  if (done % 50 === 0) {
    writeFileSync(CACHE_PATH, JSON.stringify(cache));
    console.log(`  ${done}/${targets.length}`);
  }
  await sleep(MIN_INTERVAL_MS);
}
writeFileSync(CACHE_PATH, JSON.stringify(cache));
if (failed) console.log(`실패 ${failed}건 — 다시 실행하면 그 필지만 다시 받습니다.`);

/* ── 병합 ── */

/**
 * 한 건물이 두 지번에 걸쳐 있으면 두 지번에 똑같은 호 목록이 나온다 (68-16·68-17 등).
 * 먼저 나온 지번에만 세고 나머지는 sameAs 로 가리킨다.
 */
const signature = (rows) =>
  rows
    .filter(isUnitRow)
    .map((r) => `${r.dong}|${r.ho}|${r.room}|${r.cause}|${r.date}`)
    .sort()
    .join(",");
const firstBySig = new Map();

/**
 * 땅 소유자. 호 행이 없는 필지는 소유자마다 한 줄이라 공유인 일련번호가 다른 줄 수가 곧 공유자 수다.
 */
function landOwners(rows) {
  const land = rows.filter((r) => !isUnitRow(r));
  if (!land.length) return null;
  const people = new Map();
  for (const r of land) people.set(r.sn, r);
  return {
    owners: people.size,
    corporate: [...people.values()].filter((r) => r.kind && r.kind !== "개인").length,
    asOf: land[0]?.ym ?? null,
  };
}

let merged = 0;
let units = 0;
let owners = 0;
const soldByJibun = existsSync(SOLD_PATH) ? JSON.parse(readFileSync(SOLD_PATH, "utf8")) : {};
const patterns = { whole: 0, partial: 0, none: 0, check: 0, noUnits: 0, sameAs: 0 };
const landStat = { parcels: 0, shared: 0, owners: 0 };

for (const f of parcels.features) {
  const rows = cache[f.properties.pnu];
  const b = f.properties.building;

  // 집합건축물이 아닌 필지(일반건축물·빈 땅)는 땅 공유자를 붙인다
  if (!b?.collective) {
    if (b) delete b.owners;
    const land = rows?.length ? landOwners(rows) : null;
    if (land) {
      f.properties.land = land;
      landStat.parcels += 1;
      landStat.owners += land.owners;
      if (land.owners > 1) landStat.shared += 1;
    } else {
      delete f.properties.land;
    }
    continue;
  }
  delete f.properties.land;
  if (!rows?.length) {
    delete b.owners;
    continue;
  }
  const est = estimateOwners(rows);

  // 대지권 미등기라 호 행이 하나도 없으면 판단할 수 없다 — 대장 호수(parcelOwners 기본값)로 둔다
  if (!est.units) {
    delete b.owners;
    patterns.noUnits += 1;
    continue;
  }

  const sig = signature(rows);
  const first = est.units > 1 ? firstBySig.get(sig) : undefined;
  if (first) {
    b.owners = { ...est, owners: 0, sameAs: first };
    patterns.sameAs += 1;
    continue;
  }
  firstBySig.set(sig, f.properties.jibun);

  const sold = soldByJibun[f.properties.jibun];
  if (sold) {
    est.owners += sold.added;
    est.grouped = Math.max(0, est.grouped - sold.sold);
    est.pattern = est.grouped ? "partial" : "none";
    est.sold = sold;
  }

  b.owners = est;
  merged += 1;
  units += est.units;
  owners += est.owners;
  patterns[est.pattern] += 1;
  if (est.check) patterns.check += 1;
}

writeFileSync(PARCELS_PATH, JSON.stringify(parcels, null, 0));
console.log(`
소유정보로 센 집합건축물 필지: ${merged} (호 행 없음 ${patterns.noUnits}, 다른 지번과 같은 건물 ${patterns.sameAs})`);
console.log(`호 ${units.toLocaleString()} → 추정 소유자 ${owners.toLocaleString()}명`);
console.log(
  `통건물 ${patterns.whole} · 일부 묶음 ${patterns.partial} · 묶음 없음 ${patterns.none} · 확인 필요 ${patterns.check}`,
);
console.log(
  `일반건축물·땅 ${landStat.parcels}필지 → 땅 소유자 ${landStat.owners.toLocaleString()}명 (공유 ${landStat.shared}필지)`,
);
