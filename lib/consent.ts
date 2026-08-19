import type { ConsentInfo, ParcelProps } from "./types";

/**
 * pnu → 참여의향서 제출 현황. 명부에 없는 필지는 키가 없다 (제출 0호).
 * 자료는 MongoDB 에 있고 서버에서 읽어 내려준다 (lib/consentStore.ts).
 */
export type ConsentMap = Record<string, ConsentInfo>;

export const EMPTY_CONSENT: ConsentMap = {};

export type ConsentSummary = {
  /** 명부에 한 호라도 올라온 필지 수 */
  parcels: number;
  submitted: number;
  total: number;
  /** 제출률(%) */
  ratio: number;
};

/** 필지 묶음의 제출 현황 합계. 명부에 없는 필지는 총 호수도 모르므로 제외한다. */
export function summarize(pnus: Iterable<string>, consent: ConsentMap): ConsentSummary {
  let parcels = 0;
  let submitted = 0;
  let total = 0;
  for (const pnu of pnus) {
    const c = consent[pnu];
    if (!c) continue;
    parcels += 1;
    submitted += c.submitted;
    total += c.total;
  }
  return { parcels, submitted, total, ratio: total ? Math.round((submitted / total) * 100) : 0 };
}

/**
 * 필지의 총 호수. 건축물대장 표제부의 호수·세대수·가구수 중 가장 큰 값을 쓰고,
 * 전부 0 이거나 건물 정보가 없으면 1호로 본다 (scripts/import-consent.mjs 와 같은 규칙).
 */
export function parcelUnits(props: ParcelProps): number {
  const b = props.building;
  if (!b) return 1;
  return Math.max(b.households ?? 0, b.families ?? 0, b.hoCnt ?? 0) || 1;
}

export type ZoneConsentSummary = ConsentSummary & {
  /** 구역에 편입된 필지 수 */
  zoneParcels: number;
  /** 그중 명부에 한 호라도 올라온 필지 수 */
  submittedParcels: number;
  /** 제출률의 분모로 쓴 총 소유자 수 (구역에 설정된 값) */
  owners: number | null;
  /** 소유자 수 기준 제출률(%). owners 가 없으면 호수 기준 ratio 와 같다 */
  ownerRatio: number;
};

/**
 * 구역 전체의 제출 현황.
 * 명부에 없는 필지도 총 호수에는 넣어야 "총 몇 호 중 몇 호" 가 구역 기준이 된다.
 */
export function summarizeZone(
  pnus: string[],
  propsOf: Map<string, ParcelProps>,
  consent: ConsentMap,
  owners?: number | null,
): ZoneConsentSummary {
  let submitted = 0;
  let total = 0;
  let submittedParcels = 0;
  let zoneParcels = 0;

  for (const pnu of pnus) {
    const props = propsOf.get(pnu);
    if (!props) continue; // 필지 데이터가 아직 안 왔거나 지적도에 없는 필지
    zoneParcels += 1;

    const c = consent[pnu];
    if (c) {
      submitted += c.submitted;
      total += c.total;
      submittedParcels += 1;
    } else {
      total += parcelUnits(props);
    }
  }

  const ratio = total ? Math.round((submitted / total) * 100) : 0;
  // 한 사람이 여러 호를 가진 경우가 있어, 소유자 수가 설정돼 있으면 그쪽을 분모로 쓴다
  const usable = owners && owners > 0 ? owners : null;

  return {
    parcels: submittedParcels,
    zoneParcels,
    submittedParcels,
    submitted,
    total,
    ratio,
    owners: usable,
    ownerRatio: usable ? Math.round((submitted / usable) * 100) : ratio,
  };
}

/**
 * 제출률(0~100%)에 따른 색.
 *
 * 한 호라도 제출된 필지는 제출률이 낮아도 녹색 계통으로 간다. 색상환을 빨강에서
 * 그대로 돌리면 낮은 구간이 노랑·주황이 되는데, 어두운 지도 위에서 잘 읽히지 않고
 * "아무도 안 냈음" 과도 구분이 흐려진다. 그래서 0% 만 빨강으로 따로 두고,
 * 그 위는 연두(90°)에서 초록(120°)까지의 좁은 구간을 쓴다.
 * 제출률의 높낮이는 색상보다 채도·명도·불투명도로 드러낸다.
 */
export function consentColor(ratio: number): string {
  const r = Math.max(0, Math.min(100, ratio)) / 100;
  // 네이버 지도 폴리곤은 hex 만 확실히 받으므로 hex 로 돌려준다
  if (r <= 0) return hslToHex(0, 0.34, 0.33);
  return hslToHex(90 + 30 * r, 0.55 + 0.3 * r, 0.36 + 0.14 * r);
}

/**
 * 제출률이 높을수록 진하게 채운다 — 색과 같은 방향으로 눈길을 끈다.
 * 제출이 없는 필지만 거의 투명하게 두어 지도 바닥에 묻히게 하고,
 * 필지 위치는 테두리(consentStrokeOpacity)로만 남긴다.
 */
export function consentFillOpacity(ratio: number): number {
  const r = Math.max(0, Math.min(100, ratio)) / 100;
  if (r <= 0) return 0.14;
  return 0.45 + 0.43 * r;
}

/** 채움이 옅어진 만큼 테두리로 필지 윤곽은 알아볼 수 있게 남긴다 */
export function consentStrokeOpacity(ratio: number): number {
  const r = Math.max(0, Math.min(100, ratio)) / 100;
  if (r <= 0) return 0.3;
  return 0.6 + 0.4 * r;
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : [0, c, x];
  const hex = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/**
 * 범례용 그라디언트 (0% → 100%).
 * 0% 와 그 위 사이는 색이 이어지지 않고 끊기므로, 빨강 구간을 짧게 잘라 계단을 보여준다.
 */
export const CONSENT_GRADIENT = [
  "linear-gradient(90deg",
  `${consentColor(0)} 0%`,
  `${consentColor(0)} 8%`,
  `${consentColor(1)} 8%`,
  `${consentColor(50)} 54%`,
  `${consentColor(100)} 100%)`,
].join(", ");
