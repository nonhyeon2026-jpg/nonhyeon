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
