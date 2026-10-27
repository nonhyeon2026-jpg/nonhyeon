/**
 * 구역 안 도로의 토지 매매 실거래가를 모아 도로 쪼개기(작은 지분을 여러 사람에게 판 거래)를 찾는다.
 *
 *   node --env-file=.env.local scripts/check-road-trades.mjs [시작YYYYMM] [끝YYYYMM]
 *
 * 국토교통부 토지 매매 실거래가(data.go.kr RTMSDataSvcLandTrade, 키는 land_key)는 지번을
 * 본번 첫 자리만 남기고 가린다 ("1**" = 본번 100~199). 그래서 필지를 하나로 집지는 못하고
 * 논현동 · 지목 도로 · 같은 용도지역 · 본번 자릿수 · 거래면적 ≤ 필지 면적 으로 후보를 좁힌다.
 * 구역 밖 도로도 같은 조건으로 세어 후보가 얼마나 겹치는지 함께 적는다.
 *
 * 달마다 받은 응답은 data/land-trade-cache.json 에 둔다 (공개 자료, 이름 없음).
 * 끝난 달은 다시 받지 않고, 이번 달과 지난달만 새로 받는다.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")), "..");
const KEY = process.env.land_key;
const ENDPOINT = "https://apis.data.go.kr/1613000/RTMSDataSvcLandTrade/getRTMSDataSvcLandTrade";
const LAWD = "11680"; // 강남구
const DONG = "논현동";
const ZONE_ID = "zone-msr2lpiv";
const CACHE = path.join(ROOT, "data", "land-trade-cache.json");

if (!KEY) {
  console.error("land_key 가 없습니다. node --env-file=.env.local 로 실행하세요");
  process.exit(1);
}

const ym = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
const now = new Date();
const from = process.argv[2] ?? "201501";
const to = process.argv[3] ?? ym(now);
const fresh = new Set([ym(now), ym(new Date(now.getFullYear(), now.getMonth() - 1, 1))]);

function months(a, b) {
  const out = [];
  let y = +a.slice(0, 4), m = +a.slice(4);
  while (`${y}${String(m).padStart(2, "0")}` <= b) {
    out.push(`${y}${String(m).padStart(2, "0")}`);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

const tag = (xml, name) => (xml.match(new RegExp(`<${name}>([^<]*)</${name}>`)) ?? [])[1]?.trim() ?? "";

async function fetchMonth(month) {
  const rows = [];
  for (let page = 1; ; page++) {
    const url = `${ENDPOINT}?serviceKey=${KEY}&LAWD_CD=${LAWD}&DEAL_YMD=${month}&numOfRows=1000&pageNo=${page}`;
    let xml = "";
    // 초당 요청 제한이 있어 한 번에 하나씩, 걸리면 쉬었다가 다시 받는다
    for (let tries = 0; tries < 5; tries++) {
      await new Promise((r) => setTimeout(r, 300 + tries * 1500));
      xml = await (await fetch(url)).text();
      if (!xml.includes("LIMITED_NUMBER_OF_SERVICE_REQUESTS_PER_SECOND")) break;
    }
    const code = tag(xml, "resultCode");
    if (code !== "000" && code !== "00") throw new Error(`${month}: ${tag(xml, "resultMsg") || xml.slice(0, 200)}`);
    const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
    for (const it of items) {
      rows.push({
        dong: tag(it, "umdNm"),
        jibun: tag(it, "jibun"),
        jimok: tag(it, "jimok"),
        use: tag(it, "landUse"),
        area: Number(tag(it, "dealArea")),
        amount: Number(tag(it, "dealAmount").replace(/,/g, "")),
        date: `${tag(it, "dealYear")}-${tag(it, "dealMonth").padStart(2, "0")}-${tag(it, "dealDay").padStart(2, "0")}`,
        share: tag(it, "shareDealingType") === "지분",
        direct: tag(it, "dealingGbn") === "직거래",
        canceled: tag(it, "cdealType") !== "",
      });
    }
    if (rows.length >= Number(tag(xml, "totalCount")) || items.length === 0) break;
  }
  // 논현동 것만 남긴다
  return rows.filter((r) => r.dong === DONG);
}

const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, "utf8")) : {};
let fetched = 0;
for (const month of months(from, to)) {
  if (cache[month] && !fresh.has(month)) continue;
  try {
    cache[month] = await fetchMonth(month);
    fetched++;
  } catch (e) {
    console.error(String(e.message ?? e).slice(0, 200));
  }
}
fs.writeFileSync(CACHE, JSON.stringify(cache));
console.error(`받은 달 ${fetched}개 · 캐시 ${Object.keys(cache).length}개월`);

// ── 구역 안 도로 ───────────────────────────────────────────────────────────
const parcels = JSON.parse(fs.readFileSync(path.join(ROOT, "public", "parcels.json"), "utf8")).features;
const outline = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "zone-outlines.json"), "utf8"))[ZONE_ID];

function inRing([x, y], ring) {
  let ins = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}
const inZone = (pt) => outline.paths.some((ring) => inRing(pt, ring));

// 구역 경계선은 필지 경계를 따라 그려져 있어, 중심점이 안이거나 꼭짓점 절반 이상이 안이면 구역 도로로 본다
const roads = parcels
  .filter((f) => f.properties.category === "도로")
  .map((f) => {
    const p = f.properties;
    const ring = f.geometry.coordinates[0];
    const inside = inZone([p.centroid[1], p.centroid[0]]) || ring.filter((q) => inZone(q)).length / ring.length >= 0.5;
    return { ...p, inside };
  });

const mask = (bonbun) => {
  const s = String(bonbun);
  return s[0] + "*".repeat(s.length - 1);
};
const fits = (t, r) => mask(r.bonbun) === t.jibun && r.zoning === t.use && t.area <= r.area + 0.5;

const trades = Object.values(cache).flat().filter((t) => t.jimok === "도로" && !t.canceled);
const hits = [];
for (const t of trades) {
  const cands = roads.filter((r) => fits(t, r));
  const zone = cands.filter((r) => r.inside);
  if (zone.length) hits.push({ ...t, zone, others: cands.length - zone.length });
}

// 같은 달 · 같은 가린 지번 · 같은 용도지역 으로 묶어 본다. 쪼개기라면 한 달에 작은 지분이 여러 건 몰린다
const groups = new Map();
for (const h of hits) {
  const k = `${h.date.slice(0, 7)}|${h.jibun}|${h.use}`;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(h);
}

const priv = (r) => !(r.land?.public);
console.log(`논현동 도로 매매 ${trades.length}건 중 구역 안 도로와 조건이 맞는 거래 ${hits.length}건\n`);
for (const [k, g] of [...groups].sort()) {
  const [month, jibun, use] = k.split("|");
  const cands = g[0].zone;
  const area = g.reduce((s, h) => s + h.area, 0);
  console.log(
    `${month} ${jibun} ${use.replace("일반주거지역", "")} · ${g.length}건 · 합 ${area.toFixed(2)}㎡ · ` +
      `지분 ${g.filter((h) => h.share).length} · 직거래 ${g.filter((h) => h.direct).length}`,
  );
  for (const h of g) console.log(`    ${h.date} ${h.area}㎡ ${h.amount.toLocaleString()}만원${h.share ? " 지분" : ""}${h.direct ? " 직거래" : ""}`);
  console.log(
    `    구역 안 후보: ${cands.map((r) => `${r.jibun}(${r.area}㎡${priv(r) ? `, 소유 ${r.land?.owners ?? "?"}명` : ", 국공유"})`).join(" ")}` +
      ` · 구역 밖 후보 ${g[0].others}필지`,
  );
}
