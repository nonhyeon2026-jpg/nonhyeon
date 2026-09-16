/**
 * VWorld 용도지역(LT_C_UQ111) → public/parcels.json 병합.
 *
 *   VWORLD_KEY=... npm run import:zoning
 *   (PowerShell)  $env:VWORLD_KEY="키"; npm run import:zoning
 *
 * 이 레이어에도 지번(PNU)이 없다. 용도지역 폴리곤과 필지 폴리곤을 공간조인해서 붙인다.
 *
 * 필지 중심점 한 점만 보지 않고 필지 안에 격자로 표본점을 찍어 면적 비율을 어림한다.
 * 용도지역 경계에 걸친 필지(예: 205-7 은 1종일반주거 63% / 일반상업 38%)는 중심점이
 * 어느 쪽에 떨어지느냐로 결과가 갈리기 때문이다. 가장 넓은 쪽을 zoning 으로 두고,
 * 둘 이상에 걸치면 비율을 zoningMix 에 남긴다.
 *
 * 레이어 함정: uname 이 빈 문자열인 큰 폴리곤(시군구 단위 도시지역 테두리)이 섞여 있어
 * 다른 용도지역과 겹친다. 이름 없는 폴리곤은 버린다.
 *
 * import:vworld 로 필지를 새로 받으면 이 값도 사라지므로 다시 돌려야 한다.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PARCELS_PATH = resolve(ROOT, "public/parcels.json");

const KEY = process.env.VWORLD_KEY;
const DOMAIN = process.env.VWORLD_DOMAIN ?? "http://localhost";
const LAYER = "LT_C_UQ111";
const BBOX = { minLng: 127.015, minLat: 37.5, maxLng: 127.049, maxLat: 37.528 };

/** 필지 경계상자를 GRID × GRID 로 나눠 표본점을 찍는다 */
const GRID = 16;
/** 이보다 작은 비율로 걸친 용도지역은 경계선 오차로 보고 버린다 */
const MIN_SHARE = 0.05;

if (!KEY) {
  console.error('VWORLD_KEY 환경변수가 필요합니다. 예: $env:VWORLD_KEY="키"; npm run import:zoning');
  process.exit(1);
}

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

async function fetchZoning() {
  const geomFilter = `BOX(${BBOX.minLng},${BBOX.minLat},${BBOX.maxLng},${BBOX.maxLat})`;
  const size = 1000;
  const out = [];
  for (let page = 1; ; page++) {
    const { features, total } = await vworld({
      data: LAYER,
      geomFilter,
      size: String(size),
      page: String(page),
      geometry: "true",
      attribute: "true",
    });
    out.push(...features);
    if (!features.length || page * size >= total) break;
  }
  return out;
}

/** 짝홀 규칙 */
function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** [바깥, 구멍...] 링 묶음 */
const inPolygon = (x, y, rings) =>
  inRing(x, y, rings[0]) && !rings.slice(1).some((hole) => inRing(x, y, hole));

function bboxOf(ring) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

const raw = await fetchZoning();
const areas = [];
for (const f of raw) {
  const name = String(f.properties?.uname ?? "").trim();
  if (!name) continue;
  const g = f.geometry;
  const parts = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  for (const rings of parts) areas.push({ name, rings, box: bboxOf(rings[0]) });
}
console.log(`용도지역 폴리곤 ${raw.length}건 (이름 있는 조각 ${areas.length}개)`);

/** 이 점이 속한 용도지역 이름. 없으면 null */
function zoningAt(x, y) {
  for (const a of areas) {
    const [minX, minY, maxX, maxY] = a.box;
    if (x < minX || x > maxX || y < minY || y > maxY) continue;
    if (inPolygon(x, y, a.rings)) return a.name;
  }
  return null;
}

const parcels = JSON.parse(readFileSync(PARCELS_PATH, "utf8"));
const tally = {};
let mixed = 0;
let missing = 0;

for (const f of parcels.features) {
  const rings = f.geometry.coordinates;
  const [minX, minY, maxX, maxY] = bboxOf(rings[0]);
  const counts = new Map();
  let samples = 0;

  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      const x = minX + ((i + 0.5) / GRID) * (maxX - minX);
      const y = minY + ((j + 0.5) / GRID) * (maxY - minY);
      if (!inPolygon(x, y, rings)) continue;
      samples += 1;
      const name = zoningAt(x, y);
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }

  // 가늘고 긴 필지는 격자점이 하나도 안 들어갈 수 있다 — 중심점으로 갈음한다
  if (!samples) {
    const [lat, lng] = f.properties.centroid;
    const name = zoningAt(lng, lat);
    if (name) counts.set(name, 1);
    samples = 1;
  }

  const shares = [...counts]
    .map(([name, n]) => ({ name, share: Math.round((n / samples) * 100) / 100 }))
    .filter((s) => s.share >= MIN_SHARE)
    .sort((a, b) => b.share - a.share);

  delete f.properties.zoning;
  delete f.properties.zoningMix;
  if (!shares.length) {
    missing += 1;
    f.properties.zoning = null;
    continue;
  }
  f.properties.zoning = shares[0].name;
  if (shares.length > 1) {
    f.properties.zoningMix = shares;
    mixed += 1;
  }
  tally[shares[0].name] = (tally[shares[0].name] ?? 0) + 1;
}

writeFileSync(PARCELS_PATH, JSON.stringify(parcels, null, 0));

console.log("\n용도지역별 필지 수");
for (const [name, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${name.padEnd(12, " ")} ${n.toLocaleString()}`);
}
console.log(`\n두 용도지역 이상에 걸친 필지 ${mixed}개 · 용도지역을 못 찾은 필지 ${missing}개`);
console.log("완료 → public/parcels.json");
