import { ownerBasisOf, summarizeZone } from "./consent";
import type { ConsentMap } from "./consent";
import polygonClipping from "polygon-clipping";
import type { Polygon } from "polygon-clipping";
import { pointInRing } from "./geo";
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
  /** 동의율 표시를 놓을 자리 [lat, lng] — 블록 모양의 한가운데 */
  anchor: [number, number];
  /**
   * 블록 바깥 경계. [lng, lat] 로 이뤄진 닫힌 링들(안쪽 구멍 포함). 소유자 동의율이 낮은
   * 블록에 굵은 테두리를 두르는 데 쓴다. 필지를 합친 윤곽이라 실제 경계보다 0.3m 바깥이다
   */
  outline: [number, number][][];
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
    (f) =>
      zonePnus.has(f.properties.pnu) &&
      // 지목만 도로이고 건물이 앉은 필지(176-4 등)는 실제로는 대지라 블록에 넣는다
      !(DIVIDER_CATEGORIES.has(f.properties.category) && !f.properties.building),
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
    const blockRings = idx.map((i) => rings[i]);
    const [x, y] = centerOf(blockRings);
    blocks.push({
      id: props.map((p) => p.pnu).sort()[0],
      pnus: props.map((p) => p.pnu),
      anchor: [lat0 + y / M_PER_DEG_LAT, lng0 + x / M_PER_DEG_LNG],
      outline: outlineOf(blockRings).map((r) =>
        r.map(([px, py]) => [lng0 + px / M_PER_DEG_LNG, lat0 + py / M_PER_DEG_LAT] as [number, number]),
      ),
    });
  }
  return blocks;
}

/**
 * 필지 하나의 한가운데 [lat, lng]. 블록과 같은 방법이라 ㄱ자 필지에서도 필지 안에 앉는다.
 * 저장된 centroid 는 면적 무게중심이라 옆 필지나 도로로 빠지기도 한다.
 */
export function parcelAnchor(f: ParcelFeature): [number, number] {
  const [lng0, lat0] = f.geometry.coordinates[0][0];
  const ring = f.geometry.coordinates[0].map(
    ([lng, lat]) => [(lng - lng0) * M_PER_DEG_LNG, (lat - lat0) * M_PER_DEG_LAT] as Pt,
  );
  // 큰 필지(5만㎡ 도로 등)를 1m 격자로 깔면 필지 하나에 몇 초가 걸린다.
  // 칸 수가 ANCHOR_MAX_CELLS 를 넘지 않게 격자를 키운다 — 표시 위치로는 몇 m 오차면 충분하다
  let w = 0;
  let h = 0;
  {
    const xs = ring.map((p) => p[0]);
    const ys = ring.map((p) => p[1]);
    w = Math.max(...xs) - Math.min(...xs);
    h = Math.max(...ys) - Math.min(...ys);
  }
  const cell = Math.max(CELL_M, Math.sqrt((w * h) / ANCHOR_MAX_CELLS));
  const [x, y] = centerOf([ring], cell);
  return [lat0 + y / M_PER_DEG_LAT, lng0 + x / M_PER_DEG_LNG];
}

/** 한가운데를 찾을 때 쓰는 격자 한 칸 (m) */
const CELL_M = 1;
/** 필지 한가운데를 찾을 때 격자 칸 수의 상한 */
const ANCHOR_MAX_CELLS = 4000;

/**
 * 블록 모양의 한가운데 — 경계에서 가장 멀리 떨어진 안쪽 점 (미터 평면 좌표).
 *
 * 면적 무게중심은 ㄱ자·ㄷ자 블록에서 도로 위로 빠지고, 필지 중심을 쓰면 블록
 * 가장자리 필지에 앉기도 한다. 블록을 1m 격자로 깔고 칸마다 바깥까지의 거리를
 * 재서, 가장 깊숙한 칸들 가운데 무게중심에 가까운 칸을 고른다.
 * 길쭉한 블록은 깊이가 같은 칸이 한 줄로 늘어서므로 그중 가운데로 온다.
 */
function centerOf(rings: Pt[][], cell = CELL_M): Pt {
  const { inside, w, h, cx, cy } = rasterize(rings, cell);

  // 3) 바깥까지의 거리 (체스판 거리, 앞뒤 두 번 훑기)
  const dist = new Float32Array(w * h);
  for (let k = 0; k < w * h; k++) dist[k] = inside[k] ? Infinity : 0;
  const D = Math.SQRT2;
  for (let j = 1; j < h; j++) {
    for (let i = 1; i < w - 1; i++) {
      const k = j * w + i;
      if (!dist[k]) continue;
      dist[k] = Math.min(dist[k], dist[k - 1] + 1, dist[k - w] + 1, dist[k - w - 1] + D, dist[k - w + 1] + D);
    }
  }
  for (let j = h - 2; j >= 0; j--) {
    for (let i = w - 2; i >= 1; i--) {
      const k = j * w + i;
      if (!dist[k]) continue;
      dist[k] = Math.min(dist[k], dist[k + 1] + 1, dist[k + w] + 1, dist[k + w + 1] + D, dist[k + w - 1] + D);
    }
  }

  // 4) 블록 칸들의 무게중심
  let sx = 0;
  let sy = 0;
  let n = 0;
  let best = 0;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const d = dist[j * w + i];
      if (!d) continue;
      sx += cx(i);
      sy += cy(j);
      n += 1;
      if (d > best) best = d;
    }
  }
  // 칸이 하나도 안 잡힐 만큼 작은 블록은 꼭짓점 평균으로 갈음한다
  if (!n) {
    const pts = rings.flat();
    return [
      pts.reduce((a, p) => a + p[0], 0) / pts.length,
      pts.reduce((a, p) => a + p[1], 0) / pts.length,
    ];
  }
  sx /= n;
  sy /= n;

  // 5) 거의 가장 깊은 칸들 가운데 무게중심에 가장 가까운 칸
  let pick: Pt = [sx, sy];
  let pickD = Infinity;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      if (dist[j * w + i] < best * 0.85) continue;
      const dx = cx(i) - sx;
      const dy = cy(j) - sy;
      const d = dx * dx + dy * dy;
      if (d < pickD) {
        pickD = d;
        pick = [cx(i), cy(j)];
      }
    }
  }
  return pick;
}

type Raster = {
  inside: Uint8Array;
  w: number;
  h: number;
  minX: number;
  minY: number;
  cx: (i: number) => number;
  cy: (j: number) => number;
};

/**
 * 필지 링들을 격자에 깐다 — 칸 중심이 어느 필지 안에 들면 1. 바깥 테두리에는 빈 칸을
 * 한 줄씩 남긴다. 필지 사이 지적선의 실금은 한 칸 메운다.
 */
function rasterize(rings: Pt[][], cell: number): Raster {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const r of rings) {
    for (const [x, y] of r) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  // 바깥 테두리에 빈 칸을 한 줄씩 둬야 가장자리 칸의 거리가 바르게 잡힌다
  minX -= cell;
  minY -= cell;
  const w = Math.ceil((maxX - minX) / cell) + 2;
  const h = Math.ceil((maxY - minY) / cell) + 2;
  const cx = (i: number) => minX + (i + 0.5) * cell;
  const cy = (j: number) => minY + (j + 0.5) * cell;

  // 1) 칸 중심이 어느 필지 안에 들면 블록 안
  let inside = new Uint8Array(w * h);
  for (const r of rings) {
    let rx0 = Infinity;
    let rx1 = -Infinity;
    let ry0 = Infinity;
    let ry1 = -Infinity;
    for (const [x, y] of r) {
      if (x < rx0) rx0 = x;
      if (x > rx1) rx1 = x;
      if (y < ry0) ry0 = y;
      if (y > ry1) ry1 = y;
    }
    const i0 = Math.max(0, Math.floor((rx0 - minX) / cell));
    const i1 = Math.min(w - 1, Math.ceil((rx1 - minX) / cell));
    const j0 = Math.max(0, Math.floor((ry0 - minY) / cell));
    const j1 = Math.min(h - 1, Math.ceil((ry1 - minY) / cell));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        if (!inside[j * w + i] && pointInRing(r, cx(i), cy(j))) inside[j * w + i] = 1;
      }
    }
  }

  // 2) 필지 사이 지적선의 실금이 바깥으로 잡히지 않게 한 칸 메운다 (팽창 → 침식)
  const morph = (src: Uint8Array, grow: boolean) => {
    const out = new Uint8Array(w * h);
    for (let j = 1; j < h - 1; j++) {
      for (let i = 1; i < w - 1; i++) {
        const k = j * w + i;
        const n = [k, k - 1, k + 1, k - w, k + w].map((q) => src[q]);
        out[k] = grow ? (n.some(Boolean) ? 1 : 0) : n.every(Boolean) ? 1 : 0;
      }
    }
    return out;
  };
  inside = morph(morph(inside, true), false);
  return { inside, w, h, minX, minY, cx, cy };
}

/**
 * 외곽선을 만들 때 필지마다 바깥으로 넓히는 폭 (m). 필지끼리 꼭짓점을 공유하지 않아 사이에
 * 실금이 남는데(TOUCH_M), 그대로 합치면 그 실금이 블록 안쪽 선으로 그려진다
 */
const OUTLINE_GROW_M = 0.3;
/** 합친 뒤 남은 구멍이 이보다 작으면(㎡) 버린다 — 실금이 갇힌 자국. 큰 구멍은 블록 안 남의 땅이다 */
const OUTLINE_MIN_HOLE_M2 = 30;
/** 이보다 작은 조각(㎡)은 버린다 */
const OUTLINE_MIN_PART_M2 = 5;
/** 넓히며 생긴 거의 일직선인 꼭짓점을 걷어 내는 오차 (m) */
const OUTLINE_SIMPLIFY_M = 0.15;

/** 닫힌 링의 부호 있는 면적 — 반시계면 양수 */
function signedArea(r: Pt[]): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return a / 2;
}

/**
 * 링을 바깥으로 d 만큼 민다. 꼭짓점마다 앞뒤 변의 바깥 법선을 더한 방향으로 옮긴다.
 * 뾰족한 꼭짓점이 멀리 튀지 않게 3d 까지만 민다.
 */
function grow(ring: Pt[], d: number): Pt[] {
  const pts = ring.length > 1 && ring[0][0] === ring.at(-1)![0] && ring[0][1] === ring.at(-1)![1]
    ? ring.slice(0, -1)
    : ring;
  const n = pts.length;
  if (n < 3) return ring;
  const sign = signedArea(pts) > 0 ? 1 : -1;
  const normal = (a: Pt, b: Pt): Pt => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    return [(sign * dy) / len, (-sign * dx) / len];
  };
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const cur = pts[i];
    const next = pts[(i + 1) % n];
    const n1 = normal(prev, cur);
    const n2 = normal(cur, next);
    let mx = n1[0] + n2[0];
    let my = n1[1] + n2[1];
    const ml = Math.hypot(mx, my);
    if (ml < 1e-9) {
      mx = n1[0];
      my = n1[1];
    } else {
      mx /= ml;
      my /= ml;
    }
    const cos = mx * n1[0] + my * n1[1];
    const k = Math.min(3 * d, d / Math.max(cos, 1e-6));
    out.push([cur[0] + mx * k, cur[1] + my * k]);
  }
  out.push(out[0]);
  return out;
}

/**
 * 블록 바깥 경계 (미터 평면 좌표의 닫힌 링들).
 *
 * 필지 폴리곤을 그대로 합쳐 지적선을 따라가게 한다 — 격자에서 따면 계단이 져서 선이 지그재그로
 * 그려졌다. 필지 사이 실금이 블록 안 선으로 남지 않게 필지마다 OUTLINE_GROW_M 씩 넓혀 합치므로,
 * 외곽선은 실제 경계보다 그만큼 바깥에 놓인다.
 */
function outlineOf(rings: Pt[][]): Pt[][] {
  const grown = rings.map((r) => [grow(r, OUTLINE_GROW_M)] as Polygon);
  if (!grown.length) return [];
  const merged = polygonClipping.union(grown[0], ...grown.slice(1));
  const result: Pt[][] = [];
  for (const poly of merged) {
    const [outer, ...holes] = poly as Pt[][];
    if (Math.abs(signedArea(outer)) < OUTLINE_MIN_PART_M2) continue;
    result.push(simplify(outer, OUTLINE_SIMPLIFY_M));
    for (const h of holes) {
      if (Math.abs(signedArea(h)) >= OUTLINE_MIN_HOLE_M2) result.push(simplify(h, OUTLINE_SIMPLIFY_M));
    }
  }
  return result;
}

/** 닫힌 링을 Douglas–Peucker 로 편다. 첫 점과 끝 점은 같게 남긴다 */
function simplify(ring: Pt[], tol: number): Pt[] {
  const tolSq = tol * tol;
  const keep = new Uint8Array(ring.length);
  keep[0] = keep[ring.length - 1] = 1;
  // 닫힌 링은 첫 점에서 가장 먼 점으로 둘로 나눠야 한쪽으로 쏠리지 않는다
  let far = 0;
  let farD = -1;
  for (let i = 1; i < ring.length - 1; i++) {
    const d = (ring[i][0] - ring[0][0]) ** 2 + (ring[i][1] - ring[0][1]) ** 2;
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  keep[far] = 1;
  const stack: [number, number][] = [
    [0, far],
    [far, ring.length - 1],
  ];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = -1;
    let worstD = tolSq;
    for (let i = a + 1; i < b; i++) {
      const d = distSqToSegment(ring[i], ring[a], ring[b]);
      if (d > worstD) {
        worstD = d;
        worst = i;
      }
    }
    if (worst < 0) continue;
    keep[worst] = 1;
    stack.push([a, worst], [worst, b]);
  }
  return ring.filter((_, i) => keep[i]);
}

export type BlockConsent = Block & {
  /** 블록 면적 (㎡) */
  area: number;
  /** 한 호라도 제출된 필지의 면적 (㎡) */
  consentedArea: number;
  /** 면적 동의율(%) — 구역 카드의 면적 동의율과 같은 계산 */
  areaRatio: number;
  /** 참여의향서를 낸 사람 수 (submitters 규칙) */
  people: number;
  /** 추정 소유자 수 — 지도의 소유자 숫자를 블록 안에서 더한 값 */
  owners: number;
  /** 소유자 동의율(%) = 제출 인원 / 추정 소유자. 면적처럼 소수점 한 자리까지 */
  ownerRatio: number;
};

/**
 * 블록마다 면적 동의율·소유자 동의율·제출 인원을 매긴다. 면적은 구역 카드와 같은 summarizeZone 을 쓴다.
 *
 * 소유자는 필지마다 ownerBasisOf 로 센다. 딸림 지번과 대표 지번이 다른 블록에 갈려도
 * 그 건물은 한 블록에서만 세어지도록, 필지가 속한 구역 범위(scopeOf)를 같이 넘긴다.
 * 그래야 블록 소유자를 다 더한 값이 지도 소유자 숫자의 합계와 맞는다.
 */
export function blockConsent(
  blocks: Block[],
  propsOf: Map<string, ParcelProps>,
  consent: ConsentMap,
  scopeOf?: Map<string, Set<string>>,
): BlockConsent[] {
  return blocks.map((b) => {
    const s = summarizeZone(b.pnus, propsOf, consent);
    const owners = b.pnus.reduce(
      (a, p) => a + (ownerBasisOf(p, propsOf, consent, scopeOf?.get(p))?.owners ?? 0),
      0,
    );
    return {
      ...b,
      area: s.area,
      consentedArea: s.consentedArea,
      areaRatio: s.areaRatio,
      people: s.people,
      owners,
      ownerRatio: owners ? Math.round((s.people / owners) * 1000) / 10 : 0,
    };
  });
}
