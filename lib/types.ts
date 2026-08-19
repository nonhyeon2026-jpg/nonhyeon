export type BuildingInfo = {
  /** 이 필지 위 건물 동 수 */
  count: number;
  /** 여러 필지에 걸친 건물을 공유하는 경우 연면적은 이 필지 몫이 아니다 */
  shared: boolean;
  name: string | null;
  /** 건축물대장의 주용도 (단독주택, 제2종근린생활시설 …) */
  usage: string | null;
  /** 다세대주택·다가구주택·아파트 등 세부 유형. 주택이 아니면 null */
  housingType?: string | null;
  /** 대장의 기타용도 문자열 */
  etcPurps?: string | null;
  /** 세대수 (공동주택) */
  households?: number;
  /** 가구수 (다가구주택) */
  families?: number;
  /** 호수 */
  hoCnt?: number;
  structure?: string | null;
  floors: number;
  basement: number;
  totalArea: number;
  /** 가장 오래된 사용승인일 (YYYYMMDD) */
  approvedAt: string | null;
  vlRat: number | null;
  bcRat: number | null;
};

export type ParcelProps = {
  pnu: string;
  jibun: string;
  bonbun: number;
  bubun: number;
  address: string;
  area: number;
  /** 지목 (대, 도로, 공원 …) */
  category: string;
  /** 개별공시지가 (원/㎡). 자료가 없으면 null */
  jiga?: number | null;
  /** VWorld 건물정보(LT_C_BLDGINFO) 를 공간조인해 붙인 값. 건물이 없으면 없음 */
  building?: BuildingInfo;
  /** [lat, lng] */
  centroid: [number, number];
};

export type ParcelFeature = {
  type: "Feature";
  properties: ParcelProps;
  geometry: { type: "Polygon"; coordinates: number[][][] };
};

export type ParcelCollection = {
  type: "FeatureCollection";
  /** 데이터 출처 표기 (헤더에 노출) */
  source?: string;
  features: ParcelFeature[];
};

export type Zone = {
  id: string;
  name: string;
  type: string;
  status: string;
  color: string;
  designatedAt: string;
  note: string;
  /** 이 구역에 포함된 필지의 PNU 목록 */
  parcels: string[];
  /**
   * 총 소유자(토지등소유자) 수. 제출률의 분모로 쓴다.
   * 한 사람이 여러 호를 가진 경우가 있어 건축물대장 호수 합계와는 다르다.
   */
  owners?: number;
};

export type ZoneMutation =
  | { action: "add"; zoneId: string; pnus: string[] }
  | { action: "remove"; zoneId: string; pnus: string[] }
  | { action: "clear"; zoneId: string }
  | { action: "setOwners"; zoneId: string; owners: number };

/** 지번별 참여의향서 제출 현황. MongoDB nonhyun.consent 컬렉션의 문서 형태다 */
export type ConsentInfo = {
  pnu: string;
  jibun: string;
  /** 명부에 적힌 원래 표기 (건물명이 붙어 있기도 하다) */
  label: string;
  /** 이 필지의 총 호수 */
  total: number;
  /** 참여의향서를 제출한 호수 */
  submitted: number;
  /** 제출한 호 목록. 통건물 제출("-")은 비어 있다 */
  units: string[];
  /** 통건물 소유자가 제출해 전 호가 동의한 필지 */
  wholeBuilding: boolean;
  /** 총 호수를 건축물대장에서 못 구해 제출 호수로 갈음했는지 */
  totalEstimated: boolean;
};
