/**
 * 국토교통부 건축물대장 표제부(getBrTitleInfo) → public/parcels.json 병합.
 *
 *   BLDRGST_KEY=... npm run import:bldrgst
 *
 * VWorld 건물정보(LT_C_BLDGINFO)와의 차이:
 *   - 지번(본번/부번)으로 직접 조회한다. 공간조인이 필요 없어 건물-필지 대응이 정확하다.
 *   - 다가구/다세대/연립/아파트 세부 유형과 세대수·가구수·호수가 들어 있다.
 *   - 실제로 두 출처의 용도가 자주 엇갈리는데, 이쪽이 원장이므로 이 값으로 덮어쓴다.
 *
 * 필지가 5천 개가 넘으므로 응답을 data/bldrgst-cache.json 에 저장한다.
 * 중간에 끊기거나 일일 호출 한도에 걸려도 다시 실행하면 남은 것부터 이어서 받는다.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_PATH = resolve(ROOT, "data/bldrgst-cache.json");
const PARCELS_PATH = resolve(ROOT, "public/parcels.json");

const KEY = process.env.BLDRGST_KEY;
const SIGUNGU = "11680"; // 강남구
const BJDONG = "10800"; // 논현동
const ENDPOINT = "https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo";

/**
 * data.go.kr 은 초당 요청 수를 제한한다. 동시 요청을 늘리는 것보다
 * 요청 간 최소 간격을 두는 쪽이 안정적이다.
 */
const CONCURRENCY = 2;
const MIN_INTERVAL_MS = 120;
const MAX_RETRY = 6;

if (!KEY) {
  console.error(
    'BLDRGST_KEY 환경변수가 필요합니다.\n  PowerShell: $env:BLDRGST_KEY="키"; npm run import:bldrgst',
  );
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 모든 워커가 공유하는 호출 간격 제한 */
let nextSlot = 0;
async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + MIN_INTERVAL_MS;
  if (wait) await sleep(wait);
}

/**
 * data.go.kr 인증키는 URL 인코딩된 형태로 발급된다.
 * URLSearchParams 로 넣으면 % 가 이중 인코딩되므로 문자열로 직접 붙인다.
 */
function url(bun, ji) {
  return (
    `${ENDPOINT}?serviceKey=${KEY}` +
    `&sigunguCd=${SIGUNGU}&bjdongCd=${BJDONG}&platGbCd=0&bun=${bun}&ji=${ji}` +
    `&_type=json&numOfRows=100&pageNo=1`
  );
}

async function fetchTitle(bun, ji) {
  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    try {
      await throttle();
      const res = await fetch(url(bun, ji), { signal: AbortSignal.timeout(30000) });
      const text = await res.text();

      // 키 오류와 "일일" 한도 초과만 치명적이다.
      if (text.includes("SERVICE_KEY_IS_NOT_REGISTERED")) {
        throw new Error("FATAL:등록되지 않은 인증키입니다.");
      }
      if (
        text.includes("LIMITED_NUMBER_OF_SERVICE_REQUESTS") &&
        !text.includes("PER_SECOND")
      ) {
        throw new Error("FATAL:일일 호출 한도를 초과했습니다. 내일 다시 실행하면 이어서 받습니다.");
      }
      // 초당 제한은 잠시 쉬었다 다시 보내면 된다
      if (text.includes("PER_SECOND")) {
        await sleep(300 * 2 ** attempt);
        continue;
      }
      if (text.includes("SERVICETIMEOUT_ERROR") || res.status >= 500) {
        await sleep(500 * 2 ** attempt);
        continue;
      }

      const json = JSON.parse(text);
      const items = json?.response?.body?.items;
      if (!items || items === "") return [];
      const item = items.item;
      return Array.isArray(item) ? item : [item];
    } catch (e) {
      if (String(e.message).startsWith("FATAL:")) throw e;
      if (attempt === MAX_RETRY) return null; // 캐시에 남기지 않고 다음 실행에서 재시도
      await sleep(500 * 2 ** attempt);
    }
  }
  return null;
}

/** 건축물대장의 주용도 + 기타용도에서 주택 세부 유형을 뽑는다 */
function housingTypeOf(mainPurps, etcPurps) {
  const s = `${mainPurps ?? ""} ${etcPurps ?? ""}`;
  if (s.includes("아파트")) return "아파트";
  if (s.includes("다세대")) return "다세대주택";
  if (s.includes("연립")) return "연립주택";
  if (s.includes("다가구")) return "다가구주택";
  if (s.includes("다중주택")) return "다중주택";
  if (s.includes("기숙사")) return "기숙사";
  if (mainPurps === "단독주택") return "단독주택";
  if (mainPurps === "공동주택") return "공동주택";
  return null;
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/* ── 캐시 ── */
mkdirSync(resolve(ROOT, "data"), { recursive: true });
const cache = existsSync(CACHE_PATH) ? JSON.parse(readFileSync(CACHE_PATH, "utf8")) : {};
const cachedBefore = Object.keys(cache).length;

const parcels = JSON.parse(readFileSync(PARCELS_PATH, "utf8"));
/* 지번이 없는 관리용 필지(본번 0)는 조회 대상이 아니다 */
const targets = parcels.features.filter(
  (f) => f.properties.bonbun > 0 && !(f.properties.pnu in cache),
);

console.log(
  `필지 ${parcels.features.length.toLocaleString()}개 중 조회 대상 ${targets.length.toLocaleString()}개` +
    (cachedBefore ? ` (캐시 ${cachedBefore.toLocaleString()}개는 건너뜀)` : ""),
);

let done = 0;
let failed = 0;
let fatal = null;

async function worker(queue) {
  while (queue.length && !fatal) {
    const f = queue.pop();
    const { pnu, bonbun, bubun } = f.properties;
    try {
      const items = await fetchTitle(String(bonbun).padStart(4, "0"), String(bubun).padStart(4, "0"));
      if (items === null) failed += 1;
      else cache[pnu] = items;
    } catch (e) {
      if (String(e.message).startsWith("FATAL:")) fatal = e.message.slice(6);
      else failed += 1;
    }
    done += 1;
    if (done % 200 === 0) {
      console.log(`  ${done.toLocaleString()}/${targets.length.toLocaleString()} (실패 ${failed})`);
      writeFileSync(CACHE_PATH, JSON.stringify(cache));
    }
  }
}

const queue = targets.slice();
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)));
writeFileSync(CACHE_PATH, JSON.stringify(cache));

if (fatal) console.error(`\n중단: ${fatal}`);
if (failed) console.log(`재시도 실패 ${failed}건 — 다시 실행하면 그 필지만 다시 받습니다.`);

/* ── 병합 ── */
let enriched = 0;
let households = 0;
const typeCount = {};

for (const f of parcels.features) {
  const items = cache[f.properties.pnu];
  if (!items) continue; // 아직 못 받은 필지는 기존 값을 그대로 둔다 (부분 실행 대비)
  if (!items.length) {
    // 조회했는데 대장이 없는 필지 = 나대지·도로 등. 다른 출처의 값이 남아 섞이지 않도록 지운다
    delete f.properties.building;
    continue;
  }

  const sorted = items.slice().sort((a, b) => num(b.totArea) - num(a.totArea));
  const main = sorted[0];
  const approved = items
    .map((i) => i.useAprDay)
    .filter((d) => /^\d{8}$/.test(String(d)))
    .sort();

  const hhld = items.reduce((s, i) => s + num(i.hhldCnt), 0);
  const fmly = items.reduce((s, i) => s + num(i.fmlyCnt), 0);
  const ho = items.reduce((s, i) => s + num(i.hoCnt), 0);
  const housingType = housingTypeOf(main.mainPurpsCdNm, main.etcPurps);

  f.properties.building = {
    count: items.length,
    shared: false,
    name: String(main.bldNm ?? "").trim() || null,
    usage: main.mainPurpsCdNm || null,
    /** 다세대·다가구 등 세부 유형. 주택이 아니면 null */
    housingType,
    etcPurps: main.etcPurps || null,
    /** 세대수(공동주택) / 가구수(다가구) / 호수 */
    households: hhld,
    families: fmly,
    hoCnt: ho,
    floors: Math.max(...items.map((i) => num(i.grndFlrCnt))),
    basement: Math.max(...items.map((i) => num(i.ugrndFlrCnt))),
    totalArea: Math.round(items.reduce((s, i) => s + num(i.totArea), 0)),
    approvedAt: approved[0] ?? null,
    vlRat: num(main.vlRat) || null,
    bcRat: num(main.bcRat) || null,
    structure: main.strctCdNm || null,
  };

  enriched += 1;
  households += hhld + fmly;
  if (housingType) typeCount[housingType] = (typeCount[housingType] ?? 0) + 1;
}

/* 지번이 없어 조회 대상이 아니었던 필지에 남은 다른 출처의 값을 정리한다 */
let cleaned = 0;
for (const f of parcels.features) {
  if (f.properties.building && !("housingType" in f.properties.building)) {
    delete f.properties.building;
    cleaned += 1;
  }
}
if (cleaned) console.log(`다른 출처의 잔여 건물 정보 ${cleaned}건 제거`);

parcels.source =
  String(parcels.source ?? "")
    .replace(/ \+ 건물정보.*$/, "")
    .replace(/ \+ 건축물대장.*$/, "") + " + 건축물대장 (표제부)";

writeFileSync(PARCELS_PATH, JSON.stringify(parcels, null, 0));

console.log(`\n건축물대장이 붙은 필지: ${enriched.toLocaleString()} / ${parcels.features.length.toLocaleString()}`);
console.log(`세대+가구 합계: ${households.toLocaleString()}`);
console.log(
  "주택 유형:",
  Object.entries(typeCount)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v}`)
    .join(", ") || "(없음)",
);
