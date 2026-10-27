import type { ConsentInfo, ParcelProps } from "./types";
import { residentialClass } from "./zoning";
import type { ResidentialClass } from "./zoning";

/**
 * pnu → 참여의향서 제출 현황. 명부에 없는 필지는 키가 없다 (제출 0호).
 * 자료는 MongoDB 에 있고 서버에서 읽어 내려준다 (lib/consentStore.ts).
 */
export type ConsentMap = Record<string, ConsentInfo>;

export const EMPTY_CONSENT: ConsentMap = {};

/**
 * 딸림 지번(sharedPnus)에도 대표 문서를 그대로 걸어 준다.
 *
 * 한 집합건물이 176-2·176-3 두 지번에 앉아 있고 건축물대장은 176-2 에만 등재된
 * 경우가 있다. 176-3 을 빈 칸으로 두면 지도에서 "아무도 안 냈음"(빨강)이 되고
 * 총 호수 분모에도 1호가 더 붙는다. 같은 문서를 가리키게 해 두면 색칠·표시는
 * 별도 분기 없이 저절로 맞고, 합계 쪽에서 doc.pnu 로 한 번만 세면 된다.
 */
export function expandShared(docs: Iterable<ConsentInfo>): ConsentMap {
  const map: ConsentMap = {};
  for (const doc of docs) map[doc.pnu] = doc;
  // 대표 문서를 먼저 다 걸고 나서 딸림을 건다 — 자기 명부가 있는 지번을 덮지 않게
  for (const doc of Object.values(map)) {
    for (const pnu of doc.sharedPnus ?? []) if (!map[pnu]) map[pnu] = doc;
  }
  return map;
}

/** 이 필지가 다른 지번 명부에 딸린 것인지 (대표 지번이면 false) */
export const isSharedInto = (pnu: string, c: ConsentInfo | undefined) =>
  Boolean(c && c.pnu !== pnu);

/** 저장된 명부 한 건을 맵에 반영한다. 딸림 지번 키까지 다시 건다 */
export function applyConsent(map: ConsentMap, doc: ConsentInfo): ConsentMap {
  const docs = Object.values(map).filter((d) => d.pnu !== doc.pnu);
  // 다른 문서가 이 문서의 딸림 지번을 물고 있으면 놓게 한다 (한 필지는 한 건물)
  const claimed = new Set(doc.sharedPnus ?? []);
  const kept = docs.map((d) =>
    (d.sharedPnus ?? []).some((p) => claimed.has(p))
      ? { ...d, sharedPnus: (d.sharedPnus ?? []).filter((p) => !claimed.has(p)) }
      : d,
  );
  return expandShared([...kept, doc]);
}

/** 명부에서 지번 하나를 뺀다 (딸림 지번 키도 함께 사라진다) */
export function removeConsent(map: ConsentMap, pnu: string): ConsentMap {
  return expandShared(Object.values(map).filter((d) => d.pnu !== pnu));
}

/** 정수 백분율. 분모가 0 이면 0 */
export const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);

export type ConsentSummary = {
  /** 명부에 한 호라도 올라온 필지 수 */
  parcels: number;
  /** 제출한 호수 */
  submitted: number;
  total: number;
  /** 제출률(%) */
  ratio: number;
};

/**
 * 필지의 총 호수. 건축물대장 표제부의 호수·세대수·가구수 중 가장 큰 값을 쓰고,
 * 전부 0 이거나 건물 정보가 없으면 1호로 본다 (scripts/import-consent.mjs 와 같은 규칙).
 */
export function parcelUnits(props: ParcelProps): number {
  const b = props.building;
  if (!b) return 1;
  return Math.max(b.households ?? 0, b.families ?? 0, b.hoCnt ?? 0) || 1;
}

/**
 * 토지소유정보로 보아 한 사람이 건물을 통째로 가진 필지인지 (명부의 통건물 제출과 같은 뜻).
 * 명부에 호를 나눠 적었어도(172-5 등) 낸 사람은 그 한 명이다.
 */
const ownedWhole = (props?: ParcelProps) => props?.building?.owners?.pattern === "whole";

/**
 * 명부 한 건에서 참여의향서를 낸 사람 수.
 * 통건물 제출, 또는 토지소유정보상 통건물인 필지는 소유자 한 명이 낸 것이라 1명이다.
 * 그 밖에는 호마다 한 명으로 센다 — 호 목록이 없으면 입력된 제출 호수를 쓴다.
 * 명부에서 한 사람이 여러 호를 함께 낸 묶음(unitGroups)은 한 명으로 줄인다.
 */
export const submitters = (c: ConsentInfo, props?: ParcelProps) => {
  if (c.wholeBuilding) return 1;
  if (ownedWhole(props)) return Math.min(1, c.submitted);
  const extra = liveGroups(c.units, c.unitGroups).reduce((n, g) => n + g.length - 1, 0);
  return Math.max(Math.min(1, c.submitted), c.submitted - extra);
};

/**
 * 한 사람 묶음에서 지금 호 목록에 있는 호만 남긴다. 남은 호가 하나 이하인 묶음은 버린다 —
 * 관리자가 호를 지우면 묶음도 저절로 따라 줄어야 낸 사람 수가 어긋나지 않는다.
 * 한 호가 두 묶음에 들면 앞 묶음에만 둔다.
 */
export function liveGroups(units: string[], groups?: string[][]): string[][] {
  const left = new Set(units);
  const out: string[][] = [];
  for (const g of groups ?? []) {
    const kept = [...new Set(g)].filter((u) => left.has(u));
    if (kept.length < 2) continue;
    for (const u of kept) left.delete(u);
    out.push(kept);
  }
  return out;
}

/**
 * 필지의 추정 소유자 수 (토지등소유자).
 *
 * 호수가 곧 소유자 수인 것은 집합건축물(다세대·연립·아파트)뿐이다. 다가구·단독·근생 같은
 * 일반건축물은 가구가 여럿이어도 건물 전체가 한 소유라 1명이다. 대장이 없는 땅도 1명.
 *
 * 집합건축물은 토지소유정보로 어림한 값(building.owners)이 있으면 그것을 쓴다 — 같은 날
 * 보존등기한 채 남은 호들처럼 한 사람이 여러 호를 가진 것을 묶은 값이다. 없으면 대장 호수.
 * 명부에 통건물 제출("-")로 올라와 있으면 한 사람이 다 가진 것이라 1명이다.
 * 명부에 제출한 사람이 추정보다 많으면 그쪽을 따른다 — 낸 사람보다 소유자가 적을 수는 없다.
 */
export function parcelOwners(props: ParcelProps, c?: ConsentInfo): number {
  return ownerBasis(props, c).owners;
}

/**
 * 추정 소유자 수의 성격. 지도 표시의 색을 가른다.
 * whole: 한 사람이 건물을 다 가짐 · grouped: 일부 호를 한 사람이 여럿 가짐 ·
 * units: 호마다 따로 · single: 일반건축물·땅이라 1명 · shared: 한 땅에 여러 동, 동마다 주인 ·
 * check: 공동건축주 의심 · none: 따로 세지 않음
 */
export type OwnerTone = "whole" | "grouped" | "units" | "single" | "shared" | "check" | "none";

export type OwnerBasis = {
  owners: number;
  tone: OwnerTone;
  /** 판별 원인. 첫 줄이 결론이고 아래로 근거가 붙는다 */
  reasons: string[];
};

/**
 * 지번 하나의 추정 소유자와 판별 원인. 딸림 지번은 대표 지번에서 세므로 0명이다 —
 * summarizeZone 처럼 건물 하나를 한 번만 세야 지도 숫자를 더한 값이 카드 숫자와 맞는다.
 *
 * 대표 지번이 범위(scope, 보통 그 구역의 필지) 밖이고 딸림 지번만 안에 있으면
 * (현대연립: 대장은 도로 필지 176-4 에 있고 땅은 176-5·176-10) 범위 안의 첫 딸림 지번이
 * 그 건물을 대신 센다. summarizeZone 도 이때는 딸림 쪽에서 세므로 합계가 맞는다.
 */
export function ownerBasisOf(
  pnu: string,
  propsOf: Map<string, ParcelProps>,
  consent: ConsentMap,
  scope?: Set<string>,
): OwnerBasis | null {
  const props = propsOf.get(pnu);
  if (!props) return null;
  const c = consent[pnu];
  if (isSharedInto(pnu, c)) {
    const stand = scope && !scope.has(c.pnu) && (c.sharedPnus ?? []).find((p) => scope.has(p));
    if (stand === pnu) {
      const main = ownerBasis(propsOf.get(c.pnu) ?? props, c);
      return {
        ...main,
        reasons: [
          ...main.reasons,
          `대표 지번 논현동 ${c.jibun}가 구역 밖이라 한 건물인 이 지번에서 셉니다`,
        ],
      };
    }
    return {
      owners: 0,
      tone: "none",
      reasons: [
        stand
          ? `논현동 ${c.jibun}와 한 건물 — 같은 건물의 다른 딸림 지번에서 셉니다`
          : `논현동 ${c.jibun}와 한 건물 — 그쪽에서 셉니다`,
      ],
    };
  }
  return ownerBasis(props, c);
}

/** 판별 원인까지 붙인 parcelOwners. 숫자와 설명이 어긋나지 않도록 계산은 여기 하나만 둔다 */
export function ownerBasis(props: ParcelProps, c?: ConsentInfo): OwnerBasis {
  const b = props.building;
  if (c?.wholeBuilding) {
    return { owners: 1, tone: "whole", reasons: ["명부에 통건물 제출(-)로 올라온 필지 — 1명"] };
  }

  let base: OwnerBasis;
  const o = b?.owners;
  if (o?.sameAs) {
    base = {
      owners: 0,
      tone: "none",
      reasons: [`논현동 ${o.sameAs}와 같은 건물 — 그쪽에서 셉니다`],
    };
  } else if (o) {
    const asOf = o.asOf ? ` (토지소유정보 ${o.asOf} 기준)` : " (토지소유정보)";
    if (o.pattern === "whole") {
      base = {
        owners: 1,
        tone: "whole",
        reasons: [
          `통건물 — ${o.units}호를 한 사람이 가진 것으로 봅니다`,
          `전 호의 소유권 변동이 같은 날 같은 원인입니다. 지은 채 안 팔았거나 건물째 샀습니다${asOf}`,
        ],
      };
    } else if (o.pattern === "partial") {
      base = {
        owners: o.owners,
        tone: "grouped",
        reasons: [
          `${o.units}호 → ${o.owners}명`,
          `${o.grouped}호는 같은 날 보존등기한 채 남았거나 같은 날 주소·이름을 고친 기록이 같아 한 사람씩 묶었습니다${asOf}`,
        ],
      };
    } else {
      base = {
        owners: o.owners,
        tone: "units",
        reasons: [
          `${o.units}호 → ${o.owners}명`,
          `호마다 소유권 변동 날짜가 달라 호마다 1명으로 셉니다${asOf}`,
        ],
      };
    }
    if (o.sold) {
      base.reasons.push(
        `기준월 뒤 실거래가: ${o.sold.note} (${o.sold.period}) → +${o.sold.added}명 반영`,
      );
    }
    if (o.check) {
      base.tone = "check";
      base.reasons.push(
        "같은 날 기록인데 거주지 구분이 갈립니다 — 공동건축주가 나눠 가졌을 수 있어 정부24 건축물대장 열람으로 확인이 필요합니다",
      );
    }
  } else if (b?.collective) {
    base = {
      owners: b.collective,
      tone: "units",
      reasons: [
        `집합건축물 ${b.collective}호 → 호마다 1명`,
        "토지소유정보에 호별 기록이 없어(대지권 미등기 등) 건축물대장 호수를 그대로 씁니다",
      ],
    };
  } else {
    /*
     * 일반건축물·빈 땅. 구분소유가 아니라 호·가구로는 사람을 나눌 수 없다.
     * 공동명의(한 집·한 땅을 여럿이 공유)는 1명으로 센다. 다만 한 땅에 주건축물이 여러 동
     * 앉아 있으면 동마다 주인이 따로일 수 있어, 땅 공유자 수를 넘지 않는 선에서 동마다 1명으로
     * 센다 (153-1: 단독·근생 11개 동, 땅 공유자 18명 → 11명). 자료가 없으면 1명이다.
     */
    const land = props.land;
    const dongs = b ? (b.mainCount ?? b.count) : 0;
    const what = b
      ? `일반건축물(${b.housingType ?? b.usage ?? "용도 미상"}${dongs > 1 ? ` ${dongs}개 동` : ""})`
      : "건물 없는 땅";
    const asOf = land?.asOf ? ` (토지소유정보 ${land.asOf} 기준)` : " (토지소유정보)";
    const sharers = land?.owners ?? 1;
    const owners = Math.max(1, Math.min(sharers, dongs));
    if (owners > 1) {
      base = {
        owners,
        tone: "shared",
        reasons: [
          `${what} — 동마다 1명, ${owners}명`,
          `땅을 ${sharers}명이 지분으로 나눠 가졌고 주건축물이 ${dongs}개 동이라, 동마다 주인이 따로인 것으로 봅니다${asOf}`,
        ],
      };
    } else {
      const many = b ? Math.max(b.households ?? 0, b.families ?? 0, b.hoCnt ?? 0) : 0;
      base = {
        owners: 1,
        tone: "single",
        reasons: [
          `${what} — 1명`,
          !land
            ? "토지소유정보가 없어 한 소유로 봅니다"
            : sharers > 1
              ? `땅을 ${sharers}명이 공동명의로 가졌습니다 — 공동명의는 1명으로 셉니다${asOf}`
              : `땅 소유자가 1명이고${many > 1 ? ` 대장의 ${many}가구·호도` : ""} 구분소유가 아니라 한 소유입니다${asOf}`,
        ],
      };
    }
  }

  if (c) {
    const people = submitters(c, props);
    /*
     * 낸 호의 주인은 명부로 다 드러났으므로 소유자는 많아야 "낸 사람 + 안 낸 호 수" 다.
     * 한 사람이 여러 호를 낸 필지(unitGroups)에서 추정보다 적어진다 — 173-2 는 3명이 12호를
     * 다 내서, 토지소유정보로 묶은 6명이 아니라 3명이다. 호수는 추정에 쓴 것과 같은 값을 쓴다.
     */
    const units = o ? (o.sameAs ? null : o.units) : (b?.collective ?? null);
    const cap = units === null ? Infinity : people + Math.max(0, units - c.submitted);
    if (cap < base.owners) {
      const left = cap - people;
      return {
        owners: cap,
        tone: "grouped",
        reasons: [
          `명부 제출 ${people}명이 ${c.submitted}호를 냈습니다 — ${
            left ? `안 낸 ${left}호를 더해 많아야 ${cap}명` : `전 호가 이 ${cap}명의 것`
          }`,
          `한 사람이 함께 낸 호: ${liveGroups(c.units, c.unitGroups)
            .map((g) => g.join("·"))
            .join(", ")}`,
          `추정(${base.owners}명)보다 적어 이쪽을 따릅니다`,
          ...base.reasons,
        ],
      };
    }
    if (people > base.owners) {
      return {
        owners: people,
        tone: base.tone === "none" ? "units" : base.tone,
        reasons: [
          `명부 제출 ${people}명 — 추정(${base.owners}명)보다 많아 제출 인원을 따릅니다`,
          ...base.reasons,
        ],
      };
    }
  }
  return base;
}

export type ZoneConsentSummary = ConsentSummary & {
  /** 구역에 편입된 필지 수 */
  zoneParcels: number;
  /** 그중 명부에 한 호라도 올라온 필지 수 */
  submittedParcels: number;
  /** 참여의향서를 낸 사람 수 (submitters 규칙) */
  people: number;
  /** 건축물대장·명부로 추정한 소유자 수 (parcelOwners 합계) */
  estimatedOwners: number;
  /** 직접 넣은 총 소유자 수. 없으면 null — 그때는 estimatedOwners 를 분모로 쓴다 */
  owners: number | null;
  /** 소유자 수 기준 제출률(%) = people / (owners ?? estimatedOwners) */
  ownerRatio: number;
  /** 구역에 편입된 필지의 면적 합계 (㎡) */
  area: number;
  /** 한 호라도 제출된 필지의 면적 합계 (㎡) */
  consentedArea: number;
  /** 면적 동의율(%). 소수점 한 자리까지 남긴다 */
  areaRatio: number;
};

/**
 * 필지 묶음 전체의 제출 현황.
 * 명부에 없는 필지도 총 호수에는 넣어야 "총 몇 호 중 몇 호" 가 그 범위 기준이 된다.
 *
 * 구역뿐 아니라 지도에서 그려 고른 임의의 선택에도 그대로 쓴다 — 같은 필지를 고르면
 * 구역 카드와 선택 카드의 숫자가 맞아야 하므로 계산은 여기 하나만 둔다.
 */
export function summarizeZone(
  pnus: string[],
  propsOf: Map<string, ParcelProps>,
  consent: ConsentMap,
  owners?: number | null,
): ZoneConsentSummary {
  let submitted = 0;
  let total = 0;
  let people = 0;
  let estimatedOwners = 0;
  let submittedParcels = 0;
  let zoneParcels = 0;
  let area = 0;
  let consentedArea = 0;
  const counted = new Set<string>();

  for (const pnu of pnus) {
    const props = propsOf.get(pnu);
    if (!props) continue; // 필지 데이터가 아직 안 왔거나 지적도에 없는 필지
    zoneParcels += 1;

    const c = consent[pnu];

    /*
     * 면적은 호수와 달리 필지 단위로 센다.
     * 다세대에서 한 호만 제출했어도 그 필지 면적은 전부 동의로 본다 — 토지 지분은
     * 호마다 쪼개져 있지 않고, 필지가 통째로 사업 대상에 들어가기 때문이다.
     * 딸림 지번도 같은 건물이 앉은 별개의 땅이므로 각각 더한다 (호수처럼 중복이 아니다).
     */
    area += props.area;
    if (c && c.submitted > 0) consentedArea += props.area;

    if (c) {
      // 딸림 지번은 대표 지번과 같은 문서라 이미 세어져 있다.
      // parcelUnits 로 갈음하지도 않는다 — 그 건물의 호수는 대표 쪽에 다 들어 있다.
      if (counted.has(c.pnu)) continue;
      counted.add(c.pnu);
      submitted += c.submitted;
      total += c.total;
      // 딸림 지번이면 건물이 대장에 등재된 대표 지번 쪽 정보로 센다
      const main = propsOf.get(c.pnu) ?? props;
      people += submitters(c, main);
      estimatedOwners += parcelOwners(main, c);
      submittedParcels += 1;
    } else {
      total += parcelUnits(props);
      estimatedOwners += parcelOwners(props);
    }
  }

  const ratio = pct(submitted, total);
  // 직접 넣은 소유자 수가 있으면 그쪽이 추정보다 정확하다
  const usable = owners && owners > 0 ? owners : null;
  const denom = usable ?? estimatedOwners;

  return {
    parcels: submittedParcels,
    zoneParcels,
    submittedParcels,
    submitted,
    total,
    ratio,
    people,
    estimatedOwners,
    owners: usable,
    ownerRatio: pct(people, denom),
    area,
    consentedArea,
    // 면적 요건은 1/2 처럼 경계가 딱 정해져 있어, 49.6% 가 50% 로 보이면 안 된다
    areaRatio: area ? Math.round((consentedArea / area) * 1000) / 10 : 0,
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

/**
 * 참여의향서가 없는 구역 필지를 용도지역 1·2·3종별로 나눠 칠하는 색 [hue, 채도, 명도].
 *
 * 붉은 계열 안에서만 색상을 조금씩 밀었더니(자주·빨강·주황) 옅게 깔린 지도 위에서
 * 1종과 2종이 구분되지 않았다. 제출 필지의 연두~초록(90°~120°)만 피하고
 * 색상환에서 멀리 떨어뜨린다 — 파랑(1종) · 빨강(2종) · 주황(3종).
 */
const CLASS_COLOR: Record<ResidentialClass, [number, number, number]> = {
  1: [214, 0.72, 0.46],
  2: [354, 0.66, 0.46],
  3: [32, 0.9, 0.48],
};

export function residentialColor(cls: ResidentialClass): string {
  return hslToHex(...CLASS_COLOR[cls]);
}

/**
 * 구역에 편입됐지만 참여의향서가 없는 필지의 색과 불투명도.
 *
 * 1·2·3종은 색으로 구분돼야 하므로 제출 0% 필지(0.14)보다 진하게 채운다.
 * 그래도 제출 필지(0.45~)보다는 옅게 둬 초록이 먼저 눈에 들어오게 한다.
 * 1·2·3종 일반주거가 아니면(상업·준주거 등) 지금까지처럼 0% 색으로 물린다.
 */
export function unsubmittedStyle(zoning?: string | null): {
  color: string;
  fillOpacity: number;
  strokeOpacity: number;
} {
  const cls = residentialClass(zoning);
  if (!cls) {
    return {
      color: consentColor(0),
      fillOpacity: consentFillOpacity(0),
      strokeOpacity: consentStrokeOpacity(0),
    };
  }
  return { color: residentialColor(cls), fillOpacity: 0.3, strokeOpacity: 0.7 };
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
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
