/**
 * VWorld 건물정보(LT_C_BLDGINFO) → public/parcels.json 병합.
 *
 *   VWORLD_KEY=... npm run import:buildings
 *
 * 이 레이어에는 지번(PNU)이 없다. 그래서 건물 중심점이 어느 필지 폴리곤 안에 있는지
 * 공간조인해서 붙인다. 필지 하나에 건물이 여러 동일 수 있으므로 집계해서 저장한다.
 *
 * 주의: usability 는 건축법 시행령 별표1 의 "대분류" 코드다.
 *       다가구는 단독주택(01000), 다세대·연립·아파트는 모두 공동주택(02000) 으로 묶인다.
 *       세대수/가구수와 다세대·다가구 세부 구분은 이 레이어에 없다 (건축물대장 API 필요).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const KEY = process.env.VWORLD_KEY;
const DOMAIN = process.env.VWORLD_DOMAIN ?? "http://localhost";
const LAYER = "LT_C_BLDGINFO";
const BBOX = { minLng: 127.015, minLat: 37.5, maxLng: 127.049, maxLat: 37.528 };

if (!KEY) {
  console.error('VWORLD_KEY 환경변수가 필요합니다. 예: $env:VWORLD_KEY="키"; npm run import:buildings');
  process.exit(1);
}

/** 건축법 시행령 별표1 용도 대분류 */
const USAGE = {
  "01000": "단독주택",
  "02000": "공동주택",
  "03000": "제1종근린생활시설",
  "04000": "제2종근린생활시설",
  "05000": "문화및집회시설",
  "06000": "종교시설",
  "07000": "판매시설",
  "08000": "운수시설",
  "09000": "의료시설",
  "10000": "교육연구시설",
  "11000": "노유자시설",
  "12000": "수련시설",
  "13000": "운동시설",
  "14000": "업무시설",
  "15000": "숙박시설",
  "16000": "위락시설",
  "17000": "공장",
  "18000": "창고시설",
  "19000": "위험물저장및처리시설",
  "20000": "자동차관련시설",
  "21000": "동물및식물관련시설",
  "22000": "자원순환관련시설",
  "23000": "교정및군사시설",
  "24000": "방송통신시설",
  "25000": "발전시설",
  "26000": "묘지관련시설",
  "27000": "관광휴게시설",
  "28000": "장례시설",
  "29000": "야영장시설",
};

async function vworld(params) {
  const url = new URL("https://api.vworld.kr/req/data");
  url.search = new URLSearchParams({
    service: "data",
    request: "GetFeature",
    version: "2.0",
    format: "json",
    crs: "EPSG:4326",
    key: KEY,
    domain: DOMAIN,
    ...params,
  }).toString();

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const r = (await res.json()).response;
  if (r.status === "ERROR") throw new Error(`VWorld [${r.error?.code}] ${r.error?.text}`);
  if (r.status === "NOT_FOUND") return { features: [], total: 0 };
  return {
    features: r.result?.featureCollection?.features ?? [],
    total: Number(r.record?.total ?? 0),
  };
}

function centroidOf(ring) {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    a += cross;
    cx += (ring[j][0] + ring[i][0]) * cross;
    cy += (ring[j][1] + ring[i][1]) * cross;
  }
  if (a === 0) return ring[0];
  return [cx / (3 * a), cy / (3 * a)];
}

function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** 바깥 링 안이면서 구멍에는 들어가지 않아야 그 필지다 */
function pointInParcel(pt, rings) {
  if (!pointInRing(pt, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) if (pointInRing(pt, rings[i])) return false;
  return true;
}

async function fetchBuildings() {
  const geomFilter = `BOX(${BBOX.minLng},${BBOX.minLat},${BBOX.maxLng},${BBOX.maxLat})`;
  const size = 1000;
  const out = [];
  let page = 1;
  let total = null;

  for (;;) {
    const { features, total: t } = await vworld({
      data: LAYER,
      geomFilter,
      size: String(size),
      page: String(page),
      geometry: "true",
      attribute: "true",
    });
    if (total === null) {
      total = t;
      console.log(`조회 범위 내 건물 ${total.toLocaleString()}동`);
    }
    if (!features.length) break;
    out.push(...features);
    console.log(`  page ${page}: 누적 ${out.length}`);
    if (page * size >= total) break;
    page += 1;
  }
  return out;
}

/* ── 필지 격자 색인 ── */
const parcels = JSON.parse(readFileSync(resolve(ROOT, "public/parcels.json"), "utf8"));
const CELL = 0.002;
const cellKey = (lng, lat) => `${Math.floor(lng / CELL)}:${Math.floor(lat / CELL)}`;
const grid = new Map();

for (const f of parcels.features) {
  const ring = f.geometry.coordinates[0];
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const [lng, lat] of ring) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }
  for (let x = Math.floor(minLng / CELL); x <= Math.floor(maxLng / CELL); x++) {
    for (let y = Math.floor(minLat / CELL); y <= Math.floor(maxLat / CELL); y++) {
      const k = `${x}:${y}`;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(f);
    }
  }
}

const buildings = await fetchBuildings();

/* ── 공간조인 ── */
const byParcel = new Map();
let matched = 0;

for (const b of buildings) {
  const g = b.geometry;
  if (!g) continue;
  const outer =
    g.type === "Polygon" ? g.coordinates[0] : g.coordinates[0]?.[0];
  if (!outer?.length) continue;

  const pt = centroidOf(outer);
  const candidates = grid.get(cellKey(pt[0], pt[1])) ?? [];
  const hit = candidates.find((f) => pointInParcel(pt, f.geometry.coordinates));
  if (!hit) continue;

  matched += 1;
  const p = b.properties;
  const list = byParcel.get(hit.properties.pnu) ?? [];
  list.push({
    name: p.bld_nm || null,
    usage: USAGE[p.usability] ?? (p.usability ? `기타(${p.usability})` : null),
    floors: Number(p.grnd_flr) || 0,
    basement: Number(p.ugrnd_flr) || 0,
    totalArea: Number(p.totalarea) || 0,
    approvedAt: /^\d{8}$/.test(p.useapr_day) ? p.useapr_day : null,
    vlRat: Number(p.vl_rat) || null,
    bcRat: Number(p.bc_rat) || null,
  });
  byParcel.set(hit.properties.pnu, list);
}

/*
 * 역방향 조인: 건물 한 동이 여러 필지에 걸쳐 있으면 중심점은 한 필지에만 떨어진다.
 * 아직 건물이 없는 필지는 그 중심점이 어느 건물 안에 있는지도 확인한다.
 */
const bGrid = new Map();
const bShapes = [];

for (const b of buildings) {
  const g = b.geometry;
  const outer = g?.type === "Polygon" ? g.coordinates[0] : g?.coordinates[0]?.[0];
  if (!outer?.length) continue;
  const idx = bShapes.push({ outer, props: b.properties }) - 1;

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const [lng, lat] of outer) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }
  for (let x = Math.floor(minLng / CELL); x <= Math.floor(maxLng / CELL); x++) {
    for (let y = Math.floor(minLat / CELL); y <= Math.floor(maxLat / CELL); y++) {
      const k = `${x}:${y}`;
      if (!bGrid.has(k)) bGrid.set(k, []);
      bGrid.get(k).push(idx);
    }
  }
}

let reverse = 0;
for (const f of parcels.features) {
  if (byParcel.has(f.properties.pnu)) continue;
  const [lat, lng] = f.properties.centroid;
  const candidates = bGrid.get(cellKey(lng, lat)) ?? [];
  const hit = candidates.map((i) => bShapes[i]).find((s) => pointInRing([lng, lat], s.outer));
  if (!hit) continue;

  const p = hit.props;
  byParcel.set(f.properties.pnu, [
    {
      name: p.bld_nm || null,
      usage: USAGE[p.usability] ?? (p.usability ? `기타(${p.usability})` : null),
      floors: Number(p.grnd_flr) || 0,
      basement: Number(p.ugrnd_flr) || 0,
      // 여러 필지에 걸친 건물이므로 연면적은 이 필지 몫이 아니다 → 0 으로 두고 대표값만 쓴다
      totalArea: 0,
      approvedAt: /^\d{8}$/.test(p.useapr_day) ? p.useapr_day : null,
      vlRat: Number(p.vl_rat) || null,
      bcRat: Number(p.bc_rat) || null,
      shared: true,
    },
  ]);
  reverse += 1;
}
console.log(`여러 필지에 걸친 건물로 추가 연결: ${reverse.toLocaleString()}필지`);

/* ── 필지별 집계 후 병합 ── */
let enriched = 0;
for (const f of parcels.features) {
  const list = byParcel.get(f.properties.pnu);
  if (!list?.length) {
    delete f.properties.building;
    continue;
  }
  // 대표 건물 = 연면적이 가장 큰 동
  const main = list.slice().sort((a, b) => b.totalArea - a.totalArea)[0];
  const approved = list.map((b) => b.approvedAt).filter(Boolean).sort();

  f.properties.building = {
    count: list.length,
    /** 여러 필지에 걸친 건물을 공유하는 경우 (연면적은 이 필지 몫이 아님) */
    shared: Boolean(main.shared),
    name: main.name,
    usage: main.usage,
    floors: Math.max(...list.map((b) => b.floors)),
    basement: Math.max(...list.map((b) => b.basement)),
    totalArea: Math.round(list.reduce((s, b) => s + b.totalArea, 0)),
    /** 가장 오래된 사용승인일 (노후도 판단 기준) */
    approvedAt: approved[0] ?? null,
    vlRat: main.vlRat,
    bcRat: main.bcRat,
  };
  enriched += 1;
}

parcels.source = `${String(parcels.source ?? "").replace(/ \+ 건물정보.*$/, "")} + 건물정보 (${LAYER})`;
writeFileSync(resolve(ROOT, "public/parcels.json"), JSON.stringify(parcels, null, 0));

const usageCount = {};
for (const f of parcels.features) {
  const u = f.properties.building?.usage;
  if (u) usageCount[u] = (usageCount[u] ?? 0) + 1;
}

console.log(`\n건물 ${buildings.length.toLocaleString()}동 중 ${matched.toLocaleString()}동을 필지에 연결`);
console.log(`건물 정보가 붙은 필지: ${enriched.toLocaleString()} / ${parcels.features.length.toLocaleString()}`);
console.log(
  "대표 용도 분포:",
  Object.entries(usageCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([k, v]) => `${k} ${v}`)
    .join(", "),
);
