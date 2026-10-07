import { summarizeZone } from "./consent";
import type { ConsentMap } from "./consent";
import { pointInRing } from "./geo";
import type { ConsentInfo, ParcelFeature, ParcelProps } from "./types";

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
    const [x, y] = centerOf(idx.map((i) => rings[i]));
    blocks.push({
      id: props.map((p) => p.pnu).sort()[0],
      pnus: props.map((p) => p.pnu),
      anchor: [lat0 + y / M_PER_DEG_LAT, lng0 + x / M_PER_DEG_LNG],
    });
  }
  return blocks;
}

/** 한가운데를 찾을 때 쓰는 격자 한 칸 (m) */
const CELL_M = 1;

/**
 * 블록 모양의 한가운데 — 경계에서 가장 멀리 떨어진 안쪽 점 (미터 평면 좌표).
 *
 * 면적 무게중심은 ㄱ자·ㄷ자 블록에서 도로 위로 빠지고, 필지 중심을 쓰면 블록
 * 가장자리 필지에 앉기도 한다. 블록을 1m 격자로 깔고 칸마다 바깥까지의 거리를
 * 재서, 가장 깊숙한 칸들 가운데 무게중심에 가까운 칸을 고른다.
 * 길쭉한 블록은 깊이가 같은 칸이 한 줄로 늘어서므로 그중 가운데로 온다.
 */
function centerOf(rings: Pt[][]): Pt {
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
  minX -= CELL_M;
  minY -= CELL_M;
  const w = Math.ceil((maxX - minX) / CELL_M) + 2;
  const h = Math.ceil((maxY - minY) / CELL_M) + 2;
  const cx = (i: number) => minX + (i + 0.5) * CELL_M;
  const cy = (j: number) => minY + (j + 0.5) * CELL_M;

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
    const i0 = Math.max(0, Math.floor((rx0 - minX) / CELL_M));
    const i1 = Math.min(w - 1, Math.ceil((rx1 - minX) / CELL_M));
    const j0 = Math.max(0, Math.floor((ry0 - minY) / CELL_M));
    const j1 = Math.min(h - 1, Math.ceil((ry1 - minY) / CELL_M));
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

export type BlockConsent = Block & {
  /** 블록 면적 (㎡) */
  area: number;
  /** 한 호라도 제출된 필지의 면적 (㎡) */
  consentedArea: number;
  /** 면적 동의율(%) — 구역 카드의 면적 동의율과 같은 계산 */
  areaRatio: number;
  /** 참여의향서를 낸 사람 수 (submitters 규칙) */
  people: number;
};

/**
 * 명부 한 건에서 참여의향서를 낸 사람 수.
 * 통건물 제출은 소유자 한 명이 낸 것이라 전 호가 동의여도 1명이다.
 * 그 밖에는 호마다 한 명으로 센다 — 호 목록이 없으면 입력된 제출 호수를 쓴다.
 */
export const submitters = (c: ConsentInfo) => (c.wholeBuilding ? 1 : c.submitted);

/** 블록마다 면적 동의율과 제출 인원을 매긴다. 면적은 구역 카드와 같은 summarizeZone 을 쓴다 */
export function blockConsent(
  blocks: Block[],
  propsOf: Map<string, ParcelProps>,
  consent: ConsentMap,
): BlockConsent[] {
  return blocks.map((b) => {
    const s = summarizeZone(b.pnus, propsOf, consent);
    // 딸림 지번은 대표 지번과 같은 문서라 한 번만 센다
    const counted = new Set<string>();
    let people = 0;
    for (const pnu of b.pnus) {
      const c = consent[pnu];
      if (!c || counted.has(c.pnu)) continue;
      counted.add(c.pnu);
      people += submitters(c);
    }
    return { ...b, area: s.area, consentedArea: s.consentedArea, areaRatio: s.areaRatio, people };
  });
}
