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
