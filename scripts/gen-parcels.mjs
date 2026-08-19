/**
 * 논현동 필지(지번) 샘플 데이터 생성기.
 *
 * ⚠️ 여기서 만드는 폴리곤은 실제 지적도가 아니라 "형태만 비슷한" 근사 데이터입니다.
 *    실제 서비스에서는 아래 중 하나로 data/parcels.json 을 교체하세요.
 *      - VWorld 지적도 API (LP_PA_CBND_BUBUN 레이어)
 *      - 국가공간정보포털 연속지적도 SHP → GeoJSON 변환
 *    교체 시 각 Feature 의 properties 는 { pnu, jibun, bonbun, bubun, area, category } 형태를 맞춰주세요.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** 결정적 난수 (mulberry32) — 실행할 때마다 같은 데이터가 나오도록 */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 논현동 행정경계 근사 폴리곤 ([lng, lat]) */
const DONG_BOUNDARY = [
  [127.0206, 37.5203],
  [127.0262, 37.5211],
  [127.0318, 37.5206],
  [127.0355, 37.5183],
  [127.0361, 37.5148],
  [127.0348, 37.5112],
  [127.0311, 37.5090],
  [127.0261, 37.5085],
  [127.0219, 37.5098],
  [127.0198, 37.5131],
  [127.0195, 37.5168],
  [127.0206, 37.5203],
];

function pointInPolygon([x, y], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

const LAT0 = 37.5085;
const LAT1 = 37.5212;
const LNG0 = 127.0193;
const LNG1 = 127.0363;

// 대략 50m 격자
const LAT_STEP = 0.00045;
const LNG_STEP = 0.00057;

const rows = Math.round((LAT1 - LAT0) / LAT_STEP);
const cols = Math.round((LNG1 - LNG0) / LNG_STEP);

const rand = rng(19730301);

// 격자 꼭짓점에 흔들림을 주어 필지 모양을 자연스럽게 (인접 필지는 꼭짓점 공유 → 틈 없음)
const verts = [];
for (let r = 0; r <= rows; r++) {
  const row = [];
  for (let c = 0; c <= cols; c++) {
    const jitterLat = (rand() - 0.5) * LAT_STEP * 0.45;
    const jitterLng = (rand() - 0.5) * LNG_STEP * 0.45;
    row.push([LNG0 + c * LNG_STEP + jitterLng, LAT0 + r * LAT_STEP + jitterLat]);
  }
  verts.push(row);
}

const CATEGORIES = ["주거", "주거", "주거", "근린상업", "상업", "공공"];

const features = [];
let bonbun = 1;
let bubun = 0;

for (let r = 0; r < rows; r++) {
  for (let c = 0; c < cols; c++) {
    const ring = [
      verts[r][c],
      verts[r][c + 1],
      verts[r + 1][c + 1],
      verts[r + 1][c],
      verts[r][c],
    ];
    const cx = ring.slice(0, 4).reduce((s, p) => s + p[0], 0) / 4;
    const cy = ring.slice(0, 4).reduce((s, p) => s + p[1], 0) / 4;
    if (!pointInPolygon([cx, cy], DONG_BOUNDARY)) continue;

    // 본번/부번 부여: 대체로 부번을 늘리다 가끔 본번을 올림
    if (bubun === 0 || rand() < 0.28) {
      bonbun += 1;
      bubun = 0;
    } else {
      bubun += 1;
    }
    if (bubun === 0 && rand() < 0.5) bubun = 0;
    else if (bubun === 0) bubun = 1;

    const jibun = bubun > 0 ? `${bonbun}-${bubun}` : `${bonbun}`;
    const pnu = `1168010800${String(bonbun).padStart(4, "0")}${String(bubun).padStart(4, "0")}`;

    features.push({
      type: "Feature",
      properties: {
        pnu,
        jibun,
        bonbun,
        bubun,
        address: `서울특별시 강남구 논현동 ${jibun}`,
        area: Math.round(180 + rand() * 620),
        category: CATEGORIES[Math.floor(rand() * CATEGORIES.length)],
        centroid: [Number(cy.toFixed(6)), Number(cx.toFixed(6))],
      },
      geometry: {
        type: "Polygon",
        coordinates: [ring.map(([x, y]) => [Number(x.toFixed(6)), Number(y.toFixed(6))])],
      },
    });
  }
}

mkdirSync(resolve(ROOT, "data"), { recursive: true });
mkdirSync(resolve(ROOT, "public"), { recursive: true });

writeFileSync(
  resolve(ROOT, "public/parcels.json"),
  JSON.stringify({ type: "FeatureCollection", source: "샘플 데이터 (실제 지적도 아님)", features }, null, 0),
);

writeFileSync(
  resolve(ROOT, "data/boundary.json"),
  JSON.stringify(
    {
      type: "Feature",
      properties: { name: "논현동", note: "근사 경계 (실제 행정경계 아님)" },
      geometry: { type: "Polygon", coordinates: [DONG_BOUNDARY] },
    },
    null,
    2,
  ),
);

// 초기 구역: 지도 위 특정 영역에 속한 필지를 자동으로 담아 시드 구성
function seedZone(features, test) {
  return features.filter((f) => test(f.properties.centroid)).map((f) => f.properties.pnu);
}

const zones = [
  {
    id: "nonhyun-1",
    name: "논현1재정비촉진구역",
    type: "재개발",
    status: "정비구역 지정",
    color: "#ef4444",
    designatedAt: "2023-11-16",
    note: "가로주택정비 → 재개발 전환 검토 구간 포함",
    parcels: seedZone(
      features,
      ([lat, lng]) => lat > 37.5155 && lat < 37.5196 && lng > 127.0225 && lng < 127.0281,
    ),
  },
  {
    id: "nonhyun-2",
    name: "논현2구역 공공재개발",
    type: "공공재개발",
    status: "후보지",
    color: "#f59e0b",
    designatedAt: "2024-06-04",
    note: "주민 동의율 확보 단계",
    parcels: seedZone(
      features,
      ([lat, lng]) => lat > 37.5108 && lat < 37.5142 && lng > 127.0287 && lng < 127.0338,
    ),
  },
  {
    id: "nonhyun-3",
    name: "논현3 모아타운",
    type: "모아타운",
    status: "관리계획 수립중",
    color: "#3b82f6",
    designatedAt: "2025-02-20",
    note: "소규모주택정비 관리지역",
    parcels: seedZone(
      features,
      ([lat, lng]) => lat > 37.5122 && lat < 37.5152 && lng > 127.0206 && lng < 127.0246,
    ),
  },
];

writeFileSync(resolve(ROOT, "data/zones.json"), JSON.stringify(zones, null, 2));

console.log(`필지 ${features.length}개 생성`);
for (const z of zones) console.log(`  ${z.name}: ${z.parcels.length}필지`);
