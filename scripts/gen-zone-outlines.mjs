/**
 * 구역 외곽선 계산 → data/zone-outlines.json
 *
 *   npm run gen:outlines
 *
 * 구역의 맨 바깥 경계만 닫힌 선으로 그리기 위한 자료다.
 *
 * 필지 폴리곤을 그대로 합치면 두 가지 문제가 있다.
 *   - 이웃 필지끼리 꼭짓점을 공유하지 않는다(지적도는 필지마다 독립 측량값이라
 *     전체 2,323변 중 일치하는 변이 508개뿐이다). 같은 변을 상쇄시키는 방식은 못 쓴다.
 *   - 도로는 구역에 포함되지 않아서, 정확히 합치면 블록마다 윤곽이 따로 생긴다.
 *
 * 그래서 격자에 필지를 찍고 → 닫힘 연산(팽창 후 침식)으로 내부 도로를 메우고
 * → 남은 구멍을 채운 뒤 → 격자 윤곽을 따 닫힌 링으로 만든다.
 *
 * 단, 구역 밖 필지(도로가 아닌 남의 땅)는 절대 넘지 않는다. 메우기·물림·직선화가
 * 그 위를 지나지 못하도록 금지 마스크를 만들어 매 단계 깎아낸다.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PARCELS_PATH = resolve(ROOT, "public/parcels.json");
const ZONES_PATH = resolve(ROOT, "data/zones.json");
const OUT_PATH = resolve(ROOT, "data/zone-outlines.json");

/** 격자 한 칸 크기 (m). 작을수록 윤곽이 정밀하지만 계산이 늘어난다 */
const CELL_M = 1;
/** 이 폭까지의 내부 도로를 메운다 (m). 구역을 가르는 가장 넓은 도로보다 커야 한다 */
const BRIDGE_M = 24;
/**
 * 경계를 필지 바깥으로 이만큼(m) 물린다.
 * 침식과 단순화 과정에서 경계가 필지 모서리를 살짝 파고드는 것을 막는다.
 */
const BUFFER_M = 2;
/** 윤곽 단순화 허용 오차 (m) */
const SIMPLIFY_M = 4;
/**
 * 안쪽으로 파고든 자국을 직선으로 메우는 기준.
 * 입구가 이 폭(m) 이하이면서
 */
const NOTCH_MOUTH_M = 90;
/** 메워서 늘어나는 면적이 이 값(㎡) 이하일 때만 메운다 — 구역 본래의 형상은 건드리지 않는다 */
const NOTCH_AREA_M2 = 6000;
/**
 * 직선화가 남의 필지를 이만큼(m)까지는 스쳐도 된다고 본다.
 * 인접 필지는 경계선을 맞대고 있어서 조금도 못 스치게 하면 격자 계단이 그대로 남는다.
 * 마스크를 깎을 때는 이 여유 없이 엄격하게 본다.
 */
const STRAIGHTEN_SLACK_M = 1;
/** 이 지목의 구역 밖 필지 위로는 경계를 넓혀도 된다 — 구역을 가르는 도로다 */
const CROSSABLE = new Set(["도로"]);
/**
 * 이 길이(m) 미만의 자잘한 링은 버린다.
 * 구역에 둘러싸인 남의 땅은 구멍으로 남겨야 하므로 작은 링도 살린다.
 */
const MIN_RING_M = 12;

const M_PER_DEG_LAT = 110_574;
const M_PER_DEG_LNG = 88_300;

const parcels = JSON.parse(readFileSync(PARCELS_PATH, "utf8"));
const zones = JSON.parse(readFileSync(ZONES_PATH, "utf8"));
const byPnu = new Map(parcels.features.map((f) => [f.properties.pnu, f]));

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length - 1; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** 바깥 링 안이면서 구멍 링 밖일 때만 필지 안이다 */
function pointInParcel(x, y, rings) {
  if (!pointInRing(x, y, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) if (pointInRing(x, y, rings[i])) return false;
  return true;
}

/** 가로 방향으로만 팽창(grow=true) 또는 침식한다 */
function sweepX(src, w, h, r, grow) {
  const hit = grow ? 1 : 0;
  const dst = new Uint8Array(src.length);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let v = grow ? 0 : 1;
      for (let d = -r; d <= r; d++) {
        const nx = x + d;
        // 격자 밖은 빈 칸으로 본다
        const s = nx < 0 || nx >= w ? 0 : src[row + nx];
        if (s === hit) {
          v = hit;
          break;
        }
      }
      dst[row + x] = v;
    }
  }
  return dst;
}

function transpose(src, w, h) {
  const dst = new Uint8Array(src.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) dst[x * h + y] = src[y * w + x];
  return dst;
}

/**
 * 정사각형 커널 팽창/침식. 가로로 훑고, 전치해서 다시 가로로 훑는다.
 * 원형 커널보다 모서리가 조금 각지지만 도로를 메우는 용도에는 차이가 없고 훨씬 빠르다.
 */
function morph(mask, w, h, r, grow) {
  let out = sweepX(mask, w, h, r, grow);
  out = transpose(out, w, h);
  out = sweepX(out, h, w, r, grow);
  return transpose(out, h, w);
}

/** 격자 밖에서 흘려넣어 닿지 않는 빈 칸(내부 구멍)을 채운다 */
function fillHoles(mask, w, h) {
  const outside = new Uint8Array(mask.length);
  const stack = [];
  for (let x = 0; x < w; x++) stack.push(x, 0, x, h - 1);
  for (let y = 0; y < h; y++) stack.push(0, y, w - 1, y);
  while (stack.length) {
    const y = stack.pop();
    const x = stack.pop();
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const i = y * w + x;
    if (outside[i] || mask[i]) continue;
    outside[i] = 1;
    stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
  }
  const filled = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) filled[i] = mask[i] || !outside[i] ? 1 : 0;
  return filled;
}

/**
 * 채워진 칸과 빈 칸 사이의 격자 변을 모아 닫힌 링으로 잇는다.
 * 각 변을 채워진 칸을 왼쪽에 두는 방향으로 넣으면, 끝점이 같은 변끼리 이어져 링이 닫힌다.
 */
function traceRings(mask, w, h) {
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : mask[y * w + x]);
  const key = (x, y) => y * (w + 1) + x;
  /** 격자점 → 그 점에서 출발하는 변들의 끝점 */
  const edges = new Map();

  const addEdge = (x1, y1, x2, y2) => {
    const a = key(x1, y1);
    const list = edges.get(a);
    if (list) list.push([x2, y2]);
    else edges.set(a, [[x2, y2]]);
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!at(x, y)) continue;
      if (!at(x, y - 1)) addEdge(x, y, x + 1, y);
      if (!at(x + 1, y)) addEdge(x + 1, y, x + 1, y + 1);
      if (!at(x, y + 1)) addEdge(x + 1, y + 1, x, y + 1);
      if (!at(x - 1, y)) addEdge(x, y + 1, x, y);
    }
  }

  const rings = [];
  for (const [startKey, startList] of edges) {
    while (startList.length) {
      const sx = startKey % (w + 1);
      const sy = (startKey - sx) / (w + 1);
      const ring = [[sx, sy]];
      let cx = sx;
      let cy = sy;
      let list = startList;

      while (list && list.length) {
        const [nx, ny] = list.pop();
        ring.push([nx, ny]);
        cx = nx;
        cy = ny;
        if (cx === sx && cy === sy) break;
        list = edges.get(key(cx, cy));
      }
      // 시작점으로 돌아오지 못한 조각은 버린다 (정상 마스크에서는 나오지 않는다)
      if (cx === sx && cy === sy && ring.length > 4) rings.push(ring);
    }
  }
  return rings;
}

/**
 * Douglas-Peucker 단순화.
 * segmentOk 가 주어지면 그 구간을 직선으로 대체해도 되는지 물어보고,
 * 안 된다고 하면 오차와 무관하게 쪼갠다 (남의 땅을 가로지르지 않게).
 */
function simplify(points, tolerance, segmentOk) {
  if (points.length < 3) return points;
  const sqTol = tolerance * tolerance;
  const sqSegDist = (p, a, b) => {
    let [x, y] = a;
    let dx = b[0] - x;
    let dy = b[1] - y;
    if (dx !== 0 || dy !== 0) {
      const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) [x, y] = b;
      else if (t > 0) {
        x += dx * t;
        y += dy * t;
      }
    }
    dx = p[0] - x;
    dy = p[1] - y;
    return dx * dx + dy * dy;
  };
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let index = -1;
    let maxSq = sqTol;
    for (let i = first + 1; i < last; i++) {
      const sq = sqSegDist(points[i], points[first], points[last]);
      if (sq > maxSq) {
        index = i;
        maxSq = sq;
      }
    }
    if (index === -1) {
      if (!segmentOk || last - first < 2) continue;
      if (segmentOk(points[first], points[last])) continue;
      // 직선으로 이으면 남의 땅을 지난다 — 가운데를 살려 쪼갠다
      const mid = (first + last) >> 1;
      keep[mid] = 1;
      stack.push([first, mid], [mid, last]);
      continue;
    }
    keep[index] = 1;
    stack.push([first, index], [index, last]);
  }
  return points.filter((_, i) => keep[i]);
}

/** 링의 부호 있는 면적 (미터 좌표). 양수면 반시계방향 */
function signedArea(pts) {
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum / 2;
}

/**
 * 안쪽으로 파고든 자국(주로 경계에 면한 도로)을 직선으로 메운다.
 *
 * 링을 돌며 가까운 두 꼭짓점을 잇는 현(弦)을 본다. 현이 짧고, 그 사이 구간이
 * 바깥이 아니라 안쪽으로 들어갔고(= 현으로 이으면 면적이 늘고), 늘어나는 면적이
 * 작으면 사이 점을 버리고 직선으로 잇는다. 메우기만 하므로 필지가 경계 밖으로 나가지 않는다.
 */
function crossesForbidden(ax, ay, bx, by, forbid, w, h) {
  // 좌표는 미터. 격자 한 칸의 절반 간격으로 훑는다
  const steps = Math.ceil(Math.hypot(bx - ax, by - ay) / (CELL_M / 2));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const x = Math.round((ax + (bx - ax) * t) / CELL_M);
    const y = Math.round((ay + (by - ay) * t) / CELL_M);
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    if (forbid[y * w + x]) return true;
  }
  return false;
}

function fillNotches(ring, mouthM, maxAreaM2, chordOk) {
  let pts = ring.slice(0, -1);
  /** 한 번에 건너뛸 수 있는 꼭짓점 수 — 깊은 자국도 몇 점이면 잡힌다 */
  const WINDOW = 14;

  for (let pass = 0; pass < 12; pass++) {
    const n = pts.length;
    if (n < 5) break;
    const outward = signedArea(pts) > 0 ? 1 : -1;

    let best = null;
    for (let i = 0; i < n; i++) {
      for (let span = 2; span <= Math.min(WINDOW, n - 2); span++) {
        const j = (i + span) % n;
        const dx = pts[j][0] - pts[i][0];
        const dy = pts[j][1] - pts[i][1];
        if (Math.hypot(dx, dy) > mouthM) continue;
        if (!chordOk(pts[i][0], pts[i][1], pts[j][0], pts[j][1])) continue;

        // 현과 사이 구간이 이루는 조각. 링과 반대 방향이면 안쪽으로 파인 자국이다
        const piece = [];
        for (let s = 0; s <= span; s++) piece.push(pts[(i + s) % n]);
        const area = signedArea(piece);
        if (Math.sign(area) === outward) continue; // 바깥으로 튀어나온 곳 — 그대로 둔다
        const gain = Math.abs(area);
        if (gain > maxAreaM2) continue;

        // 같은 조건이면 더 많이 지우는 쪽을 먼저 메운다
        if (!best || span > best.span) best = { i, span, n };
      }
    }
    if (!best) break;

    const keep = [];
    for (let k = 0; k <= best.n - best.span; k++) keep.push(pts[(best.i + best.span + k) % best.n]);
    pts = keep;
  }

  return [...pts, pts[0]];
}

const ringLengthM = (ring) => {
  let len = 0;
  for (let i = 1; i < ring.length; i++) {
    const dx = (ring[i][0] - ring[i - 1][0]) * M_PER_DEG_LNG;
    const dy = (ring[i][1] - ring[i - 1][1]) * M_PER_DEG_LAT;
    len += Math.hypot(dx, dy);
  }
  return len;
};

/* ------------------------------ 본체 ------------------------------ */

const out = {};

for (const zone of zones) {
  const members = zone.parcels.map((p) => byPnu.get(p)).filter(Boolean);
  if (!members.length) continue;

  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  const boxes = members.map((f) => {
    let a = Infinity;
    let b = -Infinity;
    let c = Infinity;
    let d = -Infinity;
    for (const [x, y] of f.geometry.coordinates[0]) {
      if (x < a) a = x;
      if (x > b) b = x;
      if (y < c) c = y;
      if (y > d) d = y;
    }
    if (a < minLng) minLng = a;
    if (b > maxLng) maxLng = b;
    if (c < minLat) minLat = c;
    if (d > maxLat) maxLat = d;
    return [a, c, b, d];
  });

  const cellLng = CELL_M / M_PER_DEG_LNG;
  const cellLat = CELL_M / M_PER_DEG_LAT;
  // 팽창분만큼 격자에 여유를 둬야 가장자리가 잘리지 않는다
  const pad = Math.ceil(BRIDGE_M / CELL_M) + 2;
  const originLng = minLng - pad * cellLng;
  const originLat = minLat - pad * cellLat;
  const w = Math.ceil((maxLng - minLng) / cellLng) + pad * 2;
  const h = Math.ceil((maxLat - minLat) / cellLat) + pad * 2;

  // 1) 필지를 격자에 찍는다 — 필지 경계상자 안의 칸만 검사한다
  let mask = new Uint8Array(w * h);
  members.forEach((f, i) => {
    const [bx0, by0, bx1, by1] = boxes[i];
    const x0 = Math.max(0, Math.floor((bx0 - originLng) / cellLng));
    const x1 = Math.min(w - 1, Math.ceil((bx1 - originLng) / cellLng));
    const y0 = Math.max(0, Math.floor((by0 - originLat) / cellLat));
    const y1 = Math.min(h - 1, Math.ceil((by1 - originLat) / cellLat));
    for (let y = y0; y <= y1; y++) {
      const lat = originLat + (y + 0.5) * cellLat;
      for (let x = x0; x <= x1; x++) {
        const idx = y * w + x;
        if (mask[idx]) continue;
        const lng = originLng + (x + 0.5) * cellLng;
        if (pointInParcel(lng, lat, f.geometry.coordinates)) mask[idx] = 1;
      }
    }
  });

  const filledCells = mask.reduce((s, v) => s + v, 0);

  // 구역 밖 필지 중 도로가 아닌 것 = 넘어가면 안 되는 땅
  const forbid = new Uint8Array(w * h);
  const inZone = new Set(zone.parcels);
  for (const f of parcels.features) {
    if (inZone.has(f.properties.pnu) || CROSSABLE.has(f.properties.category)) continue;
    const ring = f.geometry.coordinates[0];
    let bx0 = Infinity;
    let bx1 = -Infinity;
    let by0 = Infinity;
    let by1 = -Infinity;
    for (const [x, y] of ring) {
      if (x < bx0) bx0 = x;
      if (x > bx1) bx1 = x;
      if (y < by0) by0 = y;
      if (y > by1) by1 = y;
    }
    const x0 = Math.floor((bx0 - originLng) / cellLng);
    const x1 = Math.ceil((bx1 - originLng) / cellLng);
    const y0 = Math.floor((by0 - originLat) / cellLat);
    const y1 = Math.ceil((by1 - originLat) / cellLat);
    if (x1 < 0 || y1 < 0 || x0 >= w || y0 >= h) continue; // 격자 밖 필지
    for (let y = Math.max(0, y0); y <= Math.min(h - 1, y1); y++) {
      const lat = originLat + (y + 0.5) * cellLat;
      for (let x = Math.max(0, x0); x <= Math.min(w - 1, x1); x++) {
        const idx = y * w + x;
        if (forbid[idx] || mask[idx]) continue;
        const lng = originLng + (x + 0.5) * cellLng;
        if (pointInParcel(lng, lat, f.geometry.coordinates)) forbid[idx] = 1;
      }
    }
  }
  // 구역 필지 자체는 어떤 단계에서도 빠지면 안 된다 (이웃 필지와 측량이 겹치는 곳이 있다)
  const base = mask.slice();
  const clip = () => {
    for (let i = 0; i < mask.length; i++) {
      if (forbid[i]) mask[i] = 0;
      if (base[i]) mask[i] = 1;
    }
  };

  // 2) 닫힘 연산 — 팽창으로 도로를 메우고 같은 크기로 침식해 원래 크기로 되돌린다
  const r = Math.round(BRIDGE_M / 2 / CELL_M);
  mask = morph(mask, w, h, r, true);
  mask = morph(mask, w, h, r, false);
  clip();

  // 3) 도로에 둘러싸여 남은 내부 구멍을 채운다
  mask = fillHoles(mask, w, h);

  // 4) 필지를 살짝 감싸도록 바깥으로 물린다
  mask = morph(mask, w, h, Math.round(BUFFER_M / CELL_M), true);
  clip();
  // 남의 땅을 깎아내며 생긴 자잘한 구멍은 다시 메운다
  mask = fillHoles(mask, w, h);
  clip();

  // 5) 윤곽선 추출 → 격자 좌표를 위경도로
  // 직선으로 이을 때 남의 땅을 가로지르는지 판정한다 (좌표는 미터).
  // 필지 경계에 딱 붙은 한 겹은 깎아내, 맞닿은 변을 직선으로 뽑을 수 있게 한다.
  const forbidCore = morph(forbid, w, h, Math.round(STRAIGHTEN_SLACK_M / CELL_M), false);
  const chordOk = (ax, ay, bx, by) => !crossesForbidden(ax, ay, bx, by, forbidCore, w, h);

  const rings = traceRings(mask, w, h)
    // 단순화·만 메우기·길이 판정은 격자 칸을 미터로 환산해서 한다
    .map((ring) => ring.map(([x, y]) => [x * CELL_M, y * CELL_M]))
    .map((ring) => simplify(ring, SIMPLIFY_M, (a, b) => chordOk(a[0], a[1], b[0], b[1])))
    .map((ring) => fillNotches(ring, NOTCH_MOUTH_M, NOTCH_AREA_M2, chordOk))
    .map((ring) =>
      ring.map(([x, y]) => [
        originLng + (x / CELL_M) * cellLng,
        originLat + (y / CELL_M) * cellLat,
      ]),
    )
    .filter((ring) => ringLengthM(ring) >= MIN_RING_M)
    .sort((a, b) => ringLengthM(b) - ringLengthM(a));

  out[zone.id] = { zoneId: zone.id, name: zone.name, color: zone.color, paths: rings };
  console.log(
    `${zone.name}: ${members.length}필지 · 격자 ${w}×${h}(${filledCells}칸)` +
      ` → 닫힌 경계 ${rings.length}개 · 둘레 ${rings
        .map((ring) => `${Math.round(ringLengthM(ring))}m/${ring.length}점`)
        .join(", ")}`,
  );
}

writeFileSync(OUT_PATH, JSON.stringify(out) + "\n", "utf8");
console.log(`→ ${OUT_PATH}`);
