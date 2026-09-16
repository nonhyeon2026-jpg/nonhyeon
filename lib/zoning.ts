import type { ParcelProps } from "./types";

/** 일반주거지역의 종 (제1종·제2종·제3종) */
export type ResidentialClass = 1 | 2 | 3;

export const RESIDENTIAL_CLASSES: ResidentialClass[] = [1, 2, 3];

/** "제2종일반주거지역" → 2. 일반주거지역 1·2·3종이 아니면 null */
export function residentialClass(zoning?: string | null): ResidentialClass | null {
  const m = zoning?.match(/^제([123])종일반주거지역$/);
  return m ? (Number(m[1]) as ResidentialClass) : null;
}

/** 화면에 쓸 짧은 이름. 제2종일반주거지역 → 2종일반주거, 일반상업지역 → 일반상업 */
export const shortZoning = (zoning: string) => zoning.replace(/^제/, "").replace(/지역$/, "");

/**
 * 필지의 용도지역 표기. 두 곳 이상에 걸치면 비율을 함께 적는다.
 *   2종일반주거  /  3종일반주거 70% · 일반상업 30%
 */
export function zoningText(props: ParcelProps): string | null {
  if (props.zoningMix?.length) {
    return props.zoningMix
      .map((z) => `${shortZoning(z.name)} ${Math.round(z.share * 100)}%`)
      .join(" · ");
  }
  return props.zoning ? shortZoning(props.zoning) : null;
}
