import { summarizeZone } from "./consent";
import type { ConsentMap } from "./consent";
import type { ParcelFeature, ParcelProps } from "./types";

/**
 * 블록(가구, 街區) — 도로로 둘러싸인 필지 덩어리.
 *
 * 따로 정해 둔 블록 자료가 없어 지적도에서 만든다. 구역 필지 가운데 도로를 빼고,
 * 서로 맞닿은 필지끼리 이어 붙이면 도로가 경계가 되어 블록이 나뉜다.
 * 사도처럼 지목이 '대' 인 골목은 도로로 치지 않으므로 그 양쪽은 한 블록이 된다.
 */
export type Block = {
  id: string;
  /** 블록에 든 필지 */
  pnus: string[];
  /** 동의율 원을 놓을 자리 [lat, lng] */
  anchor: [number, number];
};

/** 블록을 가르는 지목 */
const DIVIDER_CATEGORIES = new Set(["도로"]);

/** 이 거리(m) 안으로 붙은 필지는 맞닿은 것으로 본다. 지적선의 미세한 틈을 메울 만큼만 */
const TOUCH_M = 0.5;

/** 논현동 위도에서 위·경도 1도의 거리 (m) */
const M_PER_DEG_LAT = 111_000;
const M_PER_DEG_LNG = 88_300;

type Pt = [number, number];

/** 점과 선분 사이의 거리의 제곱 */
function distSqToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len)) : 0;
  const x = a[0] + t * dx - p[0];
  const y = a[1] + t * dy - p[1];
  return x * x + y * y;
}

/**
 * 한쪽 꼭짓점이 다른 쪽 변에 TOUCH_M 안으로 붙어 있는지.
 * 꼭짓점끼리만 비교하면 T 자로 만나는 경계(한쪽 꼭짓점이 상대 변 한가운데)를 놓친다.
 */
function touches(a: Pt[], b: Pt[]): boolean {
  const tol = TOUCH_M * TOUCH_M;
  const near = (pts: Pt[], ring: Pt[]) => {
    for (const p of pts) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        if (distSqToSegment(p, ring[j], ring[i]) <= tol) return true;
      }
    }
    return false;
  };
  return near(a, b) || near(b, a);
}

/** 구역 필지들을 블록으로 묶는다. 필지 데이터가 없으면 빈 배열 */
export function computeBlocks(features: ParcelFeature[], zonePnus: Set<string>): Block[] {
  const items = features.filter(
    (f) => zonePnus.has(f.properties.pnu) && !DIVIDER_CATEGORIES.has(f.properties.category),
  );
  if (!items.length) return [];

  // 위경도를 미터 평면으로 편다 — 거리 판정을 한 단위로 하려고
  const [lng0, lat0] = items[0].geometry.coordinates[0][0];
  const rings = items.map((f) =>
    f.geometry.coordinates[0].map(
      ([lng, lat]) => [(lng - lng0) * M_PER_DEG_LNG, (lat - lat0) * M_PER_DEG_LAT] as Pt,
    ),
  );
  const boxes = rings.map((r) => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [x, y] of r) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    return [minX - TOUCH_M, maxX + TOUCH_M, minY - TOUCH_M, maxY + TOUCH_M];
  });

  // 서로소 집합 — 맞닿은 필지끼리 합친다
  const parent = items.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };

  for (let i = 0; i < items.length; i++) {
    const [ax0, ax1, ay0, ay1] = boxes[i];
    for (let j = i + 1; j < items.length; j++) {
      const [bx0, bx1, by0, by1] = boxes[j];
      if (bx0 > ax1 || bx1 < ax0 || by0 > ay1 || by1 < ay0) continue;
      const ri = find(i);
      const rj = find(j);
      if (ri === rj) continue;
      if (touches(rings[i], rings[j])) parent[ri] = rj;
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < items.length; i++) {
    const r = find(i);
    const g = groups.get(r);
    if (g) g.push(i);
    else groups.set(r, [i]);
  }

  const blocks: Block[] = [];
  for (const idx of groups.values()) {
    const props = idx.map((i) => items[i].properties);
    blocks.push({
      id: props.map((p) => p.pnu).sort()[0],
      pnus: props.map((p) => p.pnu),
      anchor: anchorOf(props),
    });
  }
  return blocks;
}

/**
 * 원을 놓을 자리. 블록의 면적 무게중심은 ㄱ자·ㄷ자 블록에서 도로 위로 빠질 수 있어,
 * 그 무게중심에 가장 가까운 필지의 중심을 쓴다 — 늘 블록 안쪽에 앉는다.
 */
function anchorOf(props: ParcelProps[]): [number, number] {
  let w = 0;
  let lat = 0;
  let lng = 0;
  for (const p of props) {
    w += p.area;
    lat += p.centroid[0] * p.area;
    lng += p.centroid[1] * p.area;
  }
  if (!w) return props[0].centroid;
  lat /= w;
  lng /= w;
  let best = props[0].centroid;
  let bestD = Infinity;
  for (const p of props) {
    const dLat = (p.centroid[0] - lat) * M_PER_DEG_LAT;
    const dLng = (p.centroid[1] - lng) * M_PER_DEG_LNG;
    const d = dLat * dLat + dLng * dLng;
    if (d < bestD) {
      bestD = d;
      best = p.centroid;
    }
  }
  return best;
}

export type BlockConsent = Block & {
  /** 블록 면적 (㎡) */
  area: number;
  /** 한 호라도 제출된 필지의 면적 (㎡) */
  consentedArea: number;
  /** 면적 동의율(%) — 구역 카드의 면적 동의율과 같은 계산 */
  areaRatio: number;
};

/** 블록마다 면적 동의율을 매긴다. 계산은 구역 카드와 같은 summarizeZone 을 쓴다 */
export function blockConsent(
  blocks: Block[],
  propsOf: Map<string, ParcelProps>,
  consent: ConsentMap,
): BlockConsent[] {
  return blocks.map((b) => {
    const s = summarizeZone(b.pnus, propsOf, consent);
    return { ...b, area: s.area, consentedArea: s.consentedArea, areaRatio: s.areaRatio };
  });
}
