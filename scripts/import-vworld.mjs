/**
 * VWorld 지적도(연속지적도) → data/parcels.json 임포트.
 *
 *   사용법:
 *     VWORLD_KEY=발급받은키 npm run import:vworld
 *     (PowerShell)  $env:VWORLD_KEY="키"; npm run import:vworld
 *
 *   키 발급: https://www.vworld.kr → 오픈API → 인증키 발급신청
 *            "데이터 API" 유형, 서비스 URL 은 http://localhost 로 등록하면 개발용으로 충분합니다.
 *
 *   레이어: LP_PA_CBND_BUBUN (연속지적도 부번포함)
 *   대상  : 서울특별시 강남구 논현동 (법정동코드 1168010800)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const KEY = process.env.VWORLD_KEY;
const DOMAIN = process.env.VWORLD_DOMAIN ?? "http://localhost";
const EMD_CD = "1168010800"; // 강남구 논현동
const PARCEL_LAYER = "LP_PA_CBND_BUBUN";
const EMD_LAYER = "LT_C_ADEMD_INFO";

/**
 * 논현동을 넉넉히 감싸는 조회 박스. 실제 필터는 PNU 접두사로 한다.
 * 논현동 행정경계 실측 범위: lng 127.0195~127.0439 / lat 37.5045~37.5232
 * 가장자리 필지가 잘리지 않도록 사방 여유를 둔다.
 */
const BBOX = { minLng: 127.015, minLat: 37.500, maxLng: 127.049, maxLat: 37.528 };

if (!KEY) {
  console.error(
    "VWORLD_KEY 환경변수가 필요합니다.\n" +
      '  PowerShell:  $env:VWORLD_KEY="발급받은키"; npm run import:vworld\n' +
      "  bash      :  VWORLD_KEY=발급받은키 npm run import:vworld",
  );
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
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const json = await res.json();
  const r = json.response;
  if (!r) throw new Error("예상치 못한 응답: " + JSON.stringify(json).slice(0, 300));
  if (r.status === "ERROR") {
    throw new Error(`VWorld 오류 [${r.error?.code}] ${r.error?.text}`);
  }
  if (r.status === "NOT_FOUND") return { features: [], total: 0 };
  return {
    features: r.result?.featureCollection?.features ?? [],
    total: Number(r.record?.total ?? 0),
  };
}

/** 위경도 폴리곤의 면적(㎡) — 등적 근사(위도별 미터 환산 후 shoelace) */
function polygonArea(ring) {
  const latAvg = (ring.reduce((s, p) => s + p[1], 0) / ring.length) * (Math.PI / 180);
  const mPerDegLat = 111132.92 - 559.82 * Math.cos(2 * latAvg) + 1.175 * Math.cos(4 * latAvg);
  const mPerDegLng = 111412.84 * Math.cos(latAvg) - 93.5 * Math.cos(3 * latAvg);
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const x1 = ring[j][0] * mPerDegLng;
    const y1 = ring[j][1] * mPerDegLat;
    const x2 = ring[i][0] * mPerDegLng;
    const y2 = ring[i][1] * mPerDegLat;
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum / 2);
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
  if (a === 0) return [ring[0][1], ring[0][0]];
  return [Number((cy / (3 * a)).toFixed(6)), Number((cx / (3 * a)).toFixed(6))];
}

/** 지목 부호(1글자) → 정식 명칭 */
const JIMOK = {
  전: "전", 답: "답", 과: "과수원", 목: "목장용지", 임: "임야", 광: "광천지",
  염: "염전", 대: "대", 장: "공장용지", 학: "학교용지", 차: "주차장",
  주: "주유소용지", 창: "창고용지", 도: "도로", 철: "철도용지", 제: "제방",
  천: "하천", 구: "구거", 유: "유지", 양: "양어장", 수: "수도용지",
  공: "공원", 체: "체육용지", 원: "유원지", 종: "종교용지", 사: "사적지",
  묘: "묘지", 잡: "잡종지",
};

/**
 * VWorld 의 jibun 은 "38 대", "1-2 도" 처럼 "지번 지목" 형태다.
 * 부호가 표에 없으면(도로구역 등) "기타"로 둔다.
 */
function categoryOf(jibunRaw) {
  const code = String(jibunRaw ?? "").trim().split(/\s+/)[1];
  return JIMOK[code] ?? "기타";
}

/**
 * 본번/부번은 PNU 에서만 뽑는다.
 * properties.bonbun 은 "26공" 처럼 지목이 붙어 나오는 경우가 있어 신뢰할 수 없다.
 * PNU 19자리 = 법정동코드(10) + 필지구분(1) + 본번(4) + 부번(4)
 */
function parseJibun(pnu) {
  const bonbun = Number(pnu.slice(11, 15));
  const bubun = Number(pnu.slice(15, 19));
  const label = bubun > 0 ? `${bonbun}-${bubun}` : `${bonbun}`;
  return { bonbun, bubun, jibun: label };
}

async function fetchAllParcels() {
  const geomFilter = `BOX(${BBOX.minLng},${BBOX.minLat},${BBOX.maxLng},${BBOX.maxLat})`;
  const size = 1000;
  const seen = new Map();
  let page = 1;
  let total = null;

  for (;;) {
    const { features, total: t } = await vworld({
      data: PARCEL_LAYER,
      geomFilter,
      size: String(size),
      page: String(page),
      geometry: "true",
      attribute: "true",
    });
    if (total === null) {
      total = t;
      console.log(`조회 범위 내 필지 ${total.toLocaleString()}건 (${Math.ceil(total / size)}페이지)`);
    }
    if (!features.length) break;

    for (const f of features) {
      const pnu = f.properties?.pnu;
      if (!pnu || !pnu.startsWith(EMD_CD)) continue; // 논현동 외 필지 제외
      if (seen.has(pnu)) continue;
      seen.set(pnu, f);
    }

    console.log(`  page ${page}: +${features.length}건 (논현동 누적 ${seen.size})`);
    if (page * size >= total) break;
    page += 1;
  }

  return [...seen.values()];
}

function toParcelFeature(f) {
  const g = f.geometry;
  /*
   * MultiPolygon 은 가장 큰 조각만 쓴다 (필지는 사실상 단일 폴리곤).
   * 단, 조각 안의 링은 전부 보존해야 한다 — [0]은 바깥 경계, [1..]은 구멍이다.
   * 도로 필지는 블록을 감싸는 고리 모양이라 구멍을 버리면 속이 꽉 찬 덩어리가 되고,
   * 그 위에 덮인 필지들이 클릭되지 않는다.
   */
  const part =
    g.type === "Polygon"
      ? g.coordinates
      : g.coordinates.slice().sort((a, b) => polygonArea(b[0]) - polygonArea(a[0]))[0];

  const rings = part.map((ring) =>
    ring.map(([x, y]) => [Number(x.toFixed(6)), Number(y.toFixed(6))]),
  );
  const coords = rings[0];
  const holesArea = rings.slice(1).reduce((s, r) => s + polygonArea(r), 0);
  const p = f.properties;
  const { bonbun, bubun, jibun } = parseJibun(p.pnu);
  const jiga = Number(p.jiga);

  return {
    type: "Feature",
    properties: {
      pnu: p.pnu,
      jibun,
      bonbun,
      bubun,
      address: `서울특별시 강남구 논현동 ${jibun}`,
      area: Math.max(0, Math.round(polygonArea(coords) - holesArea)),
      category: categoryOf(p.jibun),
      /** 개별공시지가 (원/㎡) */
      jiga: Number.isFinite(jiga) && jiga > 0 ? jiga : null,
      centroid: centroidOf(coords),
    },
    geometry: { type: "Polygon", coordinates: rings },
  };
}

async function fetchBoundary() {
  try {
    const { features } = await vworld({
      data: EMD_LAYER,
      // LT_C_ADEMD_INFO 의 emd_cd 는 8자리 (법정동코드 뒤 2자리 제외)
      attrFilter: `emd_cd:=:${EMD_CD.slice(0, 8)}`,
      size: "10",
      geometry: "true",
      attribute: "true",
    });
    if (!features.length) return null;
    const g = features[0].geometry;
    const ring =
      g.type === "Polygon"
        ? g.coordinates[0]
        : g.coordinates.map((p) => p[0]).sort((a, b) => polygonArea(b) - polygonArea(a))[0];
    return {
      type: "Feature",
      properties: { name: "논현동", source: `VWorld ${EMD_LAYER}`, emdCd: EMD_CD },
      geometry: {
        type: "Polygon",
        coordinates: [ring.map(([x, y]) => [Number(x.toFixed(6)), Number(y.toFixed(6))])],
      },
    };
  } catch (e) {
    console.warn(`행정경계 조회 실패 (기존 경계 유지): ${e.message}`);
    return null;
  }
}

const boundary = await fetchBoundary();
const raw = (await fetchAllParcels()).map(toParcelFeature);

// 면적이 0에 가까운 퇴화 폴리곤은 지도에 그려도 보이지 않으므로 버린다
let parcels = raw.filter((f) => f.properties.area >= 1);
if (raw.length !== parcels.length) {
  console.log(`퇴화 폴리곤 ${raw.length - parcels.length}건 제외`);
}

/**
 * PNU 접두사가 논현동이어도 중심점이 엉뚱한 곳에 찍힌 관리용 필지(지번 0-x)가 섞여 있다.
 * 조회 BBOX 밖으로 벗어난 것만 걷어낸다.
 *
 * 행정경계 폴리곤으로 자르지 않는 이유: VWorld 의 읍면동 경계는 꼭짓점 수십 개로
 * 단순화돼 있어 가장자리의 멀쩡한 지번까지 100건 넘게 잘려나간다.
 */
{
  const before = parcels.length;
  parcels = parcels.filter((f) => {
    const [lat, lng] = f.properties.centroid;
    return (
      lng >= BBOX.minLng && lng <= BBOX.maxLng && lat >= BBOX.minLat && lat <= BBOX.maxLat
    );
  });
  if (before !== parcels.length) {
    console.log(`조회 범위를 벗어난 필지 ${before - parcels.length}건 제외`);
  }
}

if (!parcels.length) {
  console.error("논현동 필지를 한 건도 받지 못했습니다. 인증키 권한과 BBOX 를 확인하세요.");
  process.exit(1);
}
parcels.sort((a, b) => a.properties.bonbun - b.properties.bonbun || a.properties.bubun - b.properties.bubun);

mkdirSync(resolve(ROOT, "data"), { recursive: true });
mkdirSync(resolve(ROOT, "public"), { recursive: true });
writeFileSync(
  resolve(ROOT, "public/parcels.json"),
  JSON.stringify(
    {
      type: "FeatureCollection",
      source: `VWorld 연속지적도 (${PARCEL_LAYER})`,
      features: parcels,
    },
    null,
    0,
  ),
);

if (boundary) writeFileSync(resolve(ROOT, "data/boundary.json"), JSON.stringify(boundary, null, 2));

console.log(
  `\n완료: 논현동 필지 ${parcels.length.toLocaleString()}개 → data/parcels.json` +
    (boundary ? `\n      행정경계 → data/boundary.json` : ""),
);
console.log("이제 `node scripts/reseed-zones.mjs` 로 구역의 필지 목록을 새 PNU 로 다시 맞추세요.");
