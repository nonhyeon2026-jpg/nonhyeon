/**
 * 지적도 폴리곤을 배경지도에 맞추는 보정값.
 *
 * VWorld 연속지적도와 네이버 배경지도는 측량 기준이 달라 화면에서 살짝 어긋나 보인다.
 * 데이터를 고치는 대신 그릴 때만 동쪽으로 밀어 맞춘다.
 *
 * 화면상 몇 px 인지는 배율에 따라 달라진다 (논현동 위도 기준).
 *   줌 17 → 약 1.05px · 줌 18 → 약 2.1px · 줌 19 → 약 4.2px
 * 눈에 보이는 어긋남은 배율과 무관한 실제 거리 차이이므로 미터로 잡는다.
 */
export const PARCEL_SHIFT_M = 1;

/** 논현동 위도에서 경도 1도의 거리 (m) */
const M_PER_DEG_LNG = 88_300;

export const PARCEL_SHIFT_LNG = PARCEL_SHIFT_M / M_PER_DEG_LNG;

/** 지적도 좌표 [lng, lat] 를 배경지도에 맞춰 옮긴다 */
export const shiftLng = (lng: number) => lng + PARCEL_SHIFT_LNG;

/**
 * 점이 폴리곤 링 안에 있는지 (ray casting).
 *
 * 좌표계를 가리지 않는 평면 판정이다. 화면 픽셀에도 쓰고 위경도에도 쓴다 —
 * y 축이 아래로 향하든 위로 향하든 교차 횟수는 같다.
 */
export function pointInRing(ring: [number, number][], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    // 점의 y 가 변(邊)이 걸친 구간 안에 있을 때만 교차를 따진다
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** 세 점의 방향 (양수면 반시계). 선분 교차 판정에 쓴다 */
const turn = (
  o: [number, number],
  a: [number, number],
  b: [number, number],
): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** 두 선분이 서로를 가로지르는지 (끝점만 맞닿는 경우는 제외) */
function segmentsCross(
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  p4: [number, number],
): boolean {
  const d1 = turn(p3, p4, p1);
  const d2 = turn(p3, p4, p2);
  const d3 = turn(p1, p2, p3);
  const d4 = turn(p1, p2, p4);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

/**
 * 두 링이 조금이라도 겹치는지.
 *
 * 세 가지를 본다 — 한쪽 꼭짓점이 다른 쪽 안에 있거나(어느 쪽이 더 크든 잡힌다),
 * 변끼리 가로지르거나. 변 교차까지 봐야 도로처럼 가늘고 긴 필지가 꼭짓점 없이
 * 영역을 관통하는 경우를 놓치지 않는다.
 */
export function ringsIntersect(a: [number, number][], b: [number, number][]): boolean {
  for (const [x, y] of a) if (pointInRing(b, x, y)) return true;
  for (const [x, y] of b) if (pointInRing(a, x, y)) return true;
  for (let i = 0, j = a.length - 1; i < a.length; j = i++) {
    for (let k = 0, l = b.length - 1; k < b.length; l = k++) {
      if (segmentsCross(a[j], a[i], b[l], b[k])) return true;
    }
  }
  return false;
}
