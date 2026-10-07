"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  consentColor,
  consentFillOpacity,
  consentStrokeOpacity,
  unsubmittedStyle,
} from "@/lib/consent";
import type { ConsentMap } from "@/lib/consent";
import type { BlockConsent } from "@/lib/blocks";
import { ringsIntersect, shiftLng } from "@/lib/geo";
import { blockBadgeHtml, BLOCK_BADGE_H, BLOCK_BADGE_W } from "./blockBadge";
import type { ParcelCollection, ParcelFeature, ParcelProps, Zone } from "@/lib/types";

/* 네이버 지도 JS API v3 는 타입 패키지가 없으므로 최소한으로만 선언한다 */
declare global {
  interface Window {
    naver?: any;
    /** 네이버 지도가 인증에 실패하면 이 전역 함수를 호출한다 */
    navermap_authFailure?: () => void;
  }
}

/** 지도를 처음 열었을 때의 중심 — 논현동 177-14 필지 */
const MAP_CENTER = { lat: 37.508792, lng: 127.029892 };

/** 선택한 필지를 칠하는 색 */
const SELECTED_FILL = "#22c55e";

/**
 * 화면 안 구역 미지정 필지가 이 수를 넘으면 그리지 않는다.
 * 줌 단계로 자르지 않고 실제 개수로 자르는 이유: 구역이 하나도 없을 때
 * "줌이 낮아서 아무것도 안 보이는" 상태가 되면 클릭할 대상 자체가 사라진다.
 */
const MAX_UNZONED_ON_SCREEN = 1200;

/** 내 위치 표시 색 */
const MY_LOCATION_COLOR = "#2563eb";

/** GPS 로 받은 내 위치. accuracy 는 오차 반경(m) */
type MyLocation = { lat: number; lng: number; accuracy: number };

const GEO_ERRORS: Record<number, string> = {
  1: "위치 권한이 거부되었습니다. 브라우저 설정에서 위치 접근을 허용하세요.",
  2: "현재 위치를 확인할 수 없습니다.",
  3: "위치 확인 시간이 초과되었습니다. 잠시 후 다시 시도하세요.",
};

let scriptPromise: Promise<void> | null = null;

/** 인증 실패는 스크립트 로드 이후 비동기로 통보되므로 전역 콜백으로 받는다 */
let authFailureHandler: (() => void) | null = null;
if (typeof window !== "undefined") {
  window.navermap_authFailure = () => authFailureHandler?.();
}

/** maps.js 를 한 번만 로드한다 */
function loadNaverMaps(clientId: string, keyParam: string): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.naver?.maps) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = `https://oapi.map.naver.com/openapi/v3/maps.js?${keyParam}=${encodeURIComponent(
      clientId,
    )}`;
    el.async = true;
    el.onload = () =>
      window.naver?.maps
        ? resolve()
        : reject(new Error("maps.js 는 로드됐지만 naver.maps 가 없습니다. 인증키를 확인하세요."));
    el.onerror = () =>
      reject(new Error("네이버 지도 스크립트를 불러오지 못했습니다. 인증키와 등록 도메인을 확인하세요."));
    document.head.appendChild(el);
  });

  return scriptPromise;
}

export default function NaverMapView({
  clientId,
  keyParam,
  parcels,
  boundary,
  consent: consentMap,
  zoneOf,
  visibleZoneIds,
  selected,
  blocks,
  showCadastral,
  flyTo,
  onParcelClick,
  onBlockClick,
  onLassoSelect,
  onLassoModeChange,
  onNotice,
}: {
  clientId: string;
  keyParam: string;
  parcels: ParcelCollection;
  boundary: { geometry: { coordinates: number[][][] } };
  consent: ConsentMap;
  zoneOf: Map<string, Zone>;
  visibleZoneIds: Set<string>;
  selected: Set<string>;
  /** 블록별 면적 동의율. null 이면 표시를 그리지 않는다 */
  blocks: BlockConsent[] | null;
  showCadastral: boolean;
  flyTo: [number, number] | null;
  onParcelClick: (props: ParcelProps, additive: boolean) => void;
  /** 블록 표시를 누르면 그 블록 필지를 고른다 */
  onBlockClick: (block: BlockConsent) => void;
  /** 영역을 그려 고른 필지들 (마법 선택) */
  onLassoSelect: (pnus: string[], additive: boolean) => void;
  /** 영역을 찍는 중인지 — 그동안은 지도를 덮는 다른 카드를 치운다 */
  onLassoModeChange: (on: boolean) => void;
  /** 위치 확인 실패 등 사용자에게 알릴 문구 */
  onNotice: (message: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  /** pnu → 폴리곤. 화면에 처음 들어올 때 만들고, 이후 재사용한다 */
  const polysRef = useRef<Map<string, any>>(new Map());
  const boundaryRef = useRef<any>(null);
  const cadastralRef = useRef<any>(null);
  /* 콜백은 ref 로 넘겨야 폴리곤 리스너를 다시 붙이지 않아도 최신 값을 본다 */
  const clickRef = useRef(onParcelClick);
  clickRef.current = onParcelClick;
  const noticeRef = useRef(onNotice);
  noticeRef.current = onNotice;
  const blockClickRef = useRef(onBlockClick);
  blockClickRef.current = onBlockClick;
  /** 블록 동의율 표시 */
  const blockMarkersRef = useRef<any[]>([]);

  const [ready, setReady] = useState(false);
  /** 지도 init 이벤트가 지났는지 — 네이버 지도는 컨트롤을 이 뒤에 만들어야 붙는다 */
  const [mapInit, setMapInit] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** 내 위치 버튼을 넣을 지도 컨트롤 자리 (React 포털 대상) */
  const [locateSlot, setLocateSlot] = useState<HTMLDivElement | null>(null);
  const [myLocation, setMyLocation] = useState<MyLocation | null>(null);
  /** 버튼을 눌러 첫 위치를 기다리는 중 */
  const [locating, setLocating] = useState(false);
  const watchIdRef = useRef<number | null>(null);
  /** 새 위치를 받으면 지도를 그리로 옮길지 — 버튼을 누른 직후 한 번만 */
  const centerOnFixRef = useRef(false);
  const lastFixRef = useRef<MyLocation | null>(null);
  const myMarkerRef = useRef<any>(null);
  const myAccuracyRef = useRef<any>(null);

  /** 마법 선택(영역 그리기) 버튼 자리 — 내 위치 버튼 바로 아래 */
  const [lassoSlot, setLassoSlot] = useState<HTMLDivElement | null>(null);
  const [lassoOn, setLassoOn] = useState(false);
  const lassoOnRef = useRef(false);
  lassoOnRef.current = lassoOn;
  /**
   * 찍은 점들 [lat, lng]. 지도 좌표로 들고 있어 지도를 움직여도 제자리에 남는다.
   * 상태가 아니라 ref 에 쌓고 개수만 상태로 둔다 — 지도 클릭 리스너를 점을 찍을
   * 때마다 다시 붙이지 않으려면 핸들러가 최신 배열을 ref 로 봐야 한다.
   */
  const lassoPtsRef = useRef<[number, number][]>([]);
  const [lassoCount, setLassoCount] = useState(0);
  /** 그리는 중인 도형과 꼭짓점 표시 */
  const lassoPolyRef = useRef<any>(null);
  const lassoDotsRef = useRef<any[]>([]);
  const lassoSelectRef = useRef(onLassoSelect);
  lassoSelectRef.current = onLassoSelect;
  /* 판정에 필요한 값들 — 핸들러를 다시 만들지 않게 ref 로 본다 */
  const parcelsRef = useRef(parcels);
  parcelsRef.current = parcels;
  const zoneOfRef = useRef(zoneOf);
  zoneOfRef.current = zoneOf;
  const visibleZonesRef = useRef(visibleZoneIds);
  visibleZonesRef.current = visibleZoneIds;

  /**
   * 필지별 경계상자. 화면 판정에 중심점을 쓰면 몸통이 화면을 덮고 있어도
   * 중심이 밖으로 나간 순간 사라져서, 확대할수록 구멍이 뚫린 것처럼 보인다.
   */
  const boxes = useMemo(() => {
    const m = new Map<string, [number, number, number, number]>();
    for (const f of parcels.features) {
      let minLat = Infinity;
      let maxLat = -Infinity;
      let minLng = Infinity;
      let maxLng = -Infinity;
      for (const [lng, lat] of f.geometry.coordinates[0]) {
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
      }
      m.set(f.properties.pnu, [minLat, maxLat, minLng, maxLng]);
    }
    return m;
  }, [parcels]);
  /** 지도가 멈출 때마다 올라가는 값 — 다시 그릴 트리거 */
  const [viewTick, setViewTick] = useState(0);
  const [drawn, setDrawn] = useState(0);
  /** 미지정 필지가 너무 많아 생략된 개수 (0이면 전부 그림) */
  const [skipped, setSkipped] = useState(0);

  /* 지도 생성 */
  useEffect(() => {
    let cancelled = false;

    authFailureHandler = () => {
      if (!cancelled) {
        setError(
          `인증에 실패했습니다 (Client ID: ${clientId}, 파라미터: ${keyParam}). ` +
            "등록한 Web 서비스 URL 과 현재 주소가 일치하는지, 인증 파라미터 이름이 맞는지 확인하세요.",
        );
      }
    };

    loadNaverMaps(clientId, keyParam)
      .then(() => {
        if (cancelled || !containerRef.current || mapRef.current) return;
        const naver = window.naver;
        const map = new naver.maps.Map(containerRef.current, {
          center: new naver.maps.LatLng(MAP_CENTER.lat, MAP_CENTER.lng),
          // 필지가 클릭할 만한 크기로 보이는 배율에서 시작한다
          zoom: 17,
          minZoom: 13,
          maxZoom: 20,
          zoomControl: true,
          // TOP_LEFT 는 컨트롤을 가로로 늘어놓는다. LEFT_TOP 이어야 내 위치 버튼이 그 아래로 쌓인다
          zoomControlOptions: { position: naver.maps.Position.LEFT_TOP },
          scaleControl: true,
          logoControlOptions: { position: naver.maps.Position.BOTTOM_LEFT },
        });
        mapRef.current = map;
        naver.maps.Event.once(map, "init", () => !cancelled && setMapInit(true));
        // idle = 이동/줌이 끝난 시점. 이때만 폴리곤을 다시 계산한다
        naver.maps.Event.addListener(map, "idle", () => setViewTick((t) => t + 1));
        setReady(true);
      })
      .catch((e) => !cancelled && setError((e as Error).message));

    return () => {
      cancelled = true;
      authFailureHandler = null;
    };
  }, [clientId, keyParam]);

  /* 지적편집도 레이어 */
  useEffect(() => {
    if (!ready) return;
    const naver = window.naver;
    if (!cadastralRef.current) cadastralRef.current = new naver.maps.CadastralLayer();
    cadastralRef.current.setMap(showCadastral ? mapRef.current : null);
  }, [ready, showCadastral]);

  /* 논현동 경계 */
  useEffect(() => {
    if (!ready) return;
    const naver = window.naver;
    boundaryRef.current?.setMap(null);
    boundaryRef.current = new naver.maps.Polygon({
      map: mapRef.current,
      paths: [boundary.geometry.coordinates[0].map(([lng, lat]) => new naver.maps.LatLng(lat, lng))],
      fillOpacity: 0,
      strokeColor: "#0f172a",
      strokeWeight: 3,
      strokeOpacity: 0.65,
      strokeStyle: "shortdash",
      clickable: false,
    });
  }, [ready, boundary]);

  /* 필지 데이터가 바뀌면 기존 폴리곤을 전부 버린다 */
  useEffect(() => {
    const polys = polysRef.current;
    for (const p of polys.values()) p.setMap(null);
    polys.clear();
    setViewTick((t) => t + 1);
  }, [parcels]);

  const polygonFor = useCallback((f: ParcelFeature) => {
    const naver = window.naver;
    const existing = polysRef.current.get(f.properties.pnu);
    if (existing) return existing;

    const poly = new naver.maps.Polygon({
      // 링 전체를 넘긴다 — 두 번째 링부터는 구멍으로 그려진다
      paths: f.geometry.coordinates.map((ring) =>
        ring.map(([lng, lat]) => new naver.maps.LatLng(lat, shiftLng(lng))),
      ),
      clickable: true,
      strokeWeight: 1,
      // 큰 필지(도로 등)가 작은 필지를 덮어 클릭을 가로채지 않도록 면적 역순으로 쌓는다
      zIndex: Math.max(1, 100000 - f.properties.area),
    });
    const props = f.properties;
    naver.maps.Event.addListener(poly, "click", (e: any) => {
      const ev = e.domEvent as MouseEvent;
      const additive = ev.shiftKey || ev.ctrlKey || ev.metaKey;
      // 그리는 중에는 필지를 눌러도 선택이 아니라 점이 찍힌다.
      // 필지가 지도를 덮고 있어 이 경로가 없으면 대부분의 자리에 점을 못 찍는다
      if (lassoOnRef.current) {
        addPointRef.current(e.coord, additive);
        return;
      }
      clickRef.current(props, additive);
    });
    polysRef.current.set(props.pnu, poly);
    return poly;
  }, []);

  /**
   * 화면 안에 있는 필지만 그린다.
   * 지도 이동이 끝났을 때(viewTick)와 선택/구역이 바뀔 때만 돈다.
   */
  useEffect(() => {
    if (!ready || !parcels.features.length) return;
    const map = mapRef.current;
    const bounds = map.getBounds();
    const sw = bounds.getSW();
    const ne = bounds.getNE();

    // 화면 밖으로 살짝 여유를 둬야 가장자리에서 튀지 않는다
    const padLat = (ne.lat() - sw.lat()) * 0.15;
    const padLng = (ne.lng() - sw.lng()) * 0.15;
    const viewMinLat = sw.lat() - padLat;
    const viewMaxLat = ne.lat() + padLat;
    const viewMinLng = sw.lng() - padLng;
    const viewMaxLng = ne.lng() + padLng;

    /** 필지 경계상자와 화면이 겹치는지 */
    const inView = (pnu: string) => {
      const b = boxes.get(pnu);
      if (!b) return false;
      const [minLat, maxLat, minLng, maxLng] = b;
      return (
        minLat <= viewMaxLat && maxLat >= viewMinLat && minLng <= viewMaxLng && maxLng >= viewMinLng
      );
    };

    // 1) 구역에 속하거나 선택된 필지는 화면 안이면 무조건 그린다
    // 2) 미지정 필지는 화면 안 개수가 상한을 넘지 않을 때만 그린다
    const primary: ParcelFeature[] = [];
    const unzoned: ParcelFeature[] = [];

    for (const f of parcels.features) {
      const { pnu } = f.properties;
      const zone = zoneOf.get(pnu);
      const inVisibleZone = zone ? visibleZoneIds.has(zone.id) : false;

      if (!inView(pnu)) continue;
      if (inVisibleZone || selected.has(pnu) || consentMap[pnu]) primary.push(f);
      else unzoned.push(f);
    }

    const drawUnzoned = unzoned.length <= MAX_UNZONED_ON_SCREEN;
    setSkipped(drawUnzoned ? 0 : unzoned.length);

    const shown = new Set<string>();
    let count = 0;

    for (const f of drawUnzoned ? [...primary, ...unzoned] : primary) {
      const { pnu } = f.properties;
      const zone = zoneOf.get(pnu);
      const inVisibleZone = zone ? visibleZoneIds.has(zone.id) : false;
      const isSelected = selected.has(pnu);
      const consent = consentMap[pnu];
      /**
       * 구역에 편입된 필지는 명부에 한 호도 없어도 0% 로 칠한다.
       * 회색으로 두면 "자료 없음" 과 "아무도 안 냈음" 이 구분되지 않는다.
       */
      // 반올림하지 않는다 — 0.4% 가 0% 로 접히면 제출이 있는 필지가 빨강이 된다
      const ratio = consent
        ? (consent.submitted / consent.total) * 100
        : inVisibleZone
          ? 0
          : null;

      const poly = polygonFor(f);
      shown.add(pnu);
      count += 1;

      /**
       * 스타일은 한 번에 계산해 setOptions 를 한 번만 부른다.
       * 나눠서 두 번 부르면 나중 호출의 채움색이 반영되지 않는 경우가 있다.
       */
      let style: Record<string, unknown>;

      if (consent) {
        // 제출률 색이 구역 색보다 우선한다 — 두 색을 겹치면 어느 쪽도 읽히지 않는다
        const color = consentColor(ratio!);
        style = {
          fillColor: color,
          fillOpacity: consentFillOpacity(ratio!),
          strokeColor: color,
          // 명부에 제출 기록이 있는 필지는 테두리를 한 겹 굵게 해 눈에 띄게 한다
          strokeWeight: 2.2,
          // 참여율이 낮은 필지는 테두리도 함께 물러난다
          strokeOpacity: consentStrokeOpacity(ratio!),
        };
      } else if (ratio !== null) {
        // 제출이 없는 구역 필지는 용도지역(1·2·3종)별로 색을 나눈다
        const u = unsubmittedStyle(f.properties.zoning);
        style = {
          fillColor: u.color,
          fillOpacity: u.fillOpacity,
          strokeColor: u.color,
          strokeWeight: 1.2,
          strokeOpacity: u.strokeOpacity,
        };
      } else {
        // 명부에도 구역에도 없는 필지까지 칠하면 화면이 온통 색이 되어
        // 그라디언트가 묻힌다. 배경으로 물린다.
        style = {
          fillColor: "#64748b",
          fillOpacity: 0.1,
          strokeColor: "#94a3b8",
          strokeWeight: 0.6,
          strokeOpacity: 0.45,
        };
      }

      if (isSelected) {
        // 선택한 필지는 제출률·구역 색과 무관하게 항상 녹색 + 검은 테두리로 표시한다.
        // 어떤 색 위에서도 "지금 고른 필지" 가 한눈에 들어와야 한다.
        style = {
          ...style,
          fillColor: SELECTED_FILL,
          fillOpacity: 0.65,
          strokeColor: "#000000",
          strokeWeight: 4,
          strokeOpacity: 1,
        };
      }

      poly.setOptions(style);

      if (!poly.getMap()) poly.setMap(map);
    }

    // 화면 밖으로 나갔거나 조건에서 빠진 폴리곤은 지도에서 뗀다 (객체는 재사용)
    for (const [pnu, poly] of polysRef.current) {
      if (!shown.has(pnu) && poly.getMap()) poly.setMap(null);
    }

    setDrawn(count);
  }, [
    ready,
    viewTick,
    parcels,
    zoneOf,
    visibleZoneIds,
    selected,
    consentMap,
    polygonFor,
    boxes,
  ]);

  /*
   * 블록 동의율 표시. 블록은 60개 남짓이라 화면 판정 없이 전부 올린다.
   * 필지 폴리곤(zIndex 최대 100000)보다 위에 와야 가려지지 않는다.
   */
  useEffect(() => {
    if (!ready) return;
    const naver = window.naver;
    for (const m of blockMarkersRef.current) m.setMap(null);
    blockMarkersRef.current = (blocks ?? []).map((b) => {
      const marker = new naver.maps.Marker({
        map: mapRef.current,
        position: new naver.maps.LatLng(b.anchor[0], shiftLng(b.anchor[1])),
        title: `블록 면적 동의율 ${b.areaRatio}% · ${b.people}명 제출 · 필지 ${b.pnus.length}개`,
        zIndex: 200000,
        icon: {
          content: blockBadgeHtml(b.areaRatio, b.people),
          anchor: new naver.maps.Point(BLOCK_BADGE_W / 2, BLOCK_BADGE_H / 2),
        },
      });
      naver.maps.Event.addListener(marker, "click", () => blockClickRef.current(b));
      return marker;
    });
    return () => {
      for (const m of blockMarkersRef.current) m.setMap(null);
      blockMarkersRef.current = [];
    };
  }, [ready, blocks]);

  /* 컴포넌트가 사라질 때 정리 */
  useEffect(
    () => () => {
      for (const p of polysRef.current.values()) p.setMap(null);
      polysRef.current.clear();
    },
    [],
  );

  /* 검색 결과로 이동 */
  useEffect(() => {
    if (!ready || !flyTo) return;
    const naver = window.naver;
    const map = mapRef.current;
    map.setZoom(Math.max(map.getZoom(), 18), true);
    map.panTo(new naver.maps.LatLng(flyTo[0], flyTo[1]));
  }, [ready, flyTo]);

  /*
   * 내 위치 버튼 자리.
   * CustomControl 은 HTML 문자열로 제 요소를 만들어 쓰므로(넘긴 DOM 요소는 붙이지 않는다)
   * 빈 칸을 만들게 한 뒤 그 요소에 버튼을 포털로 그린다.
   * 확대·축소 컨트롤과 같은 LEFT_TOP 에, 그보다 나중에 붙여야 바로 아래에 온다.
   */
  useEffect(() => {
    if (!mapInit) return;
    const naver = window.naver;
    const control = new naver.maps.CustomControl("<div></div>", {
      position: naver.maps.Position.LEFT_TOP,
    });
    control.setMap(mapRef.current);
    setLocateSlot(control.getElement());
    return () => {
      control.setMap(null);
      setLocateSlot(null);
    };
  }, [mapInit]);

  /* 마법 선택 버튼 자리. 내 위치 버튼보다 나중에 붙여야 그 아래에 온다 */
  useEffect(() => {
    if (!mapInit) return;
    const naver = window.naver;
    const control = new naver.maps.CustomControl("<div></div>", {
      position: naver.maps.Position.LEFT_TOP,
    });
    control.setMap(mapRef.current);
    setLassoSlot(control.getElement());
    return () => {
      control.setMap(null);
      setLassoSlot(null);
    };
  }, [mapInit]);

  /**
   * 찍어 만든 영역에 걸친 구역 필지를 고른다.
   *
   * 판정은 화면 좌표에서 한다. 폴리곤을 그릴 때 쓰는 변환(fromCoordToOffset)을
   * 그대로 써야 "그린 자리" 와 "칠해지는 자리" 가 어긋나지 않는다.
   * 찍은 점은 배경지도를 직접 누른 좌표라 그대로 두고, 필지만 그릴 때처럼
   * shiftLng 로 밀어서 본다.
   *
   * 온전히 들어온 필지만 고르지 않는다 — 선에 걸치기만 해도 고른다.
   * 구역계를 잡을 때 경계에 걸친 필지를 빠뜨리지 않는 쪽이 낫다.
   *
   * 대상은 구역에 편입된 필지다. 보이지 않는 구역의 필지는 지도에 그려지지도
   * 않으므로 제외한다 — 눈에 보이는 것만 고른다.
   */
  const selectWithin = useCallback((pts: [number, number][], additive: boolean) => {
    const map = mapRef.current;
    // 점 세 개는 있어야 면이 된다
    if (!map || pts.length < 3) return;
    const naver = window.naver;
    const proj = map.getProjection();
    if (typeof proj?.fromCoordToOffset !== "function") {
      noticeRef.current("⚠️ 이 지도 버전에서는 영역 선택을 쓸 수 없습니다.");
      return;
    }

    const toScreen = (lat: number, lng: number): [number, number] => {
      const o = proj.fromCoordToOffset(new naver.maps.LatLng(lat, lng));
      return [o.x, o.y];
    };

    const area = pts.map(([lat, lng]) => toScreen(lat, lng));
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [x, y] of area) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

    const hits: string[] = [];
    for (const f of parcelsRef.current.features) {
      const { pnu } = f.properties;
      const zone = zoneOfRef.current.get(pnu);
      if (!zone || !visibleZonesRef.current.has(zone.id)) continue;

      // 경계상자가 안 겹치면 변끼리 대조할 것도 없다
      let pMinX = Infinity;
      let pMaxX = -Infinity;
      let pMinY = Infinity;
      let pMaxY = -Infinity;
      const ring = f.geometry.coordinates[0].map(([lng, lat]) => {
        const p = toScreen(lat, shiftLng(lng));
        if (p[0] < pMinX) pMinX = p[0];
        if (p[0] > pMaxX) pMaxX = p[0];
        if (p[1] < pMinY) pMinY = p[1];
        if (p[1] > pMaxY) pMaxY = p[1];
        return p;
      });
      if (pMaxX < minX || pMinX > maxX || pMaxY < minY || pMinY > maxY) continue;

      if (ringsIntersect(ring, area)) hits.push(pnu);
    }
    lassoSelectRef.current(hits, additive);
  }, []);

  /** 찍은 점을 모두 지운다 */
  const clearLasso = useCallback(() => {
    lassoPtsRef.current = [];
    setLassoCount(0);
  }, []);

  /**
   * 영역을 확정한다. 점이 셋 미만이면 아직 면이 아니다.
   * 확정하면 모드에서 나온다 — 결과(선택 영역 카드·알림)를 바로 봐야 하는데
   * 그리는 동안은 그것들을 치워 두기 때문이다. 또 그리려면 버튼을 다시 누른다.
   */
  const completeLasso = useCallback(
    (additive: boolean) => {
      const pts = lassoPtsRef.current;
      if (pts.length < 3) return;
      clearLasso();
      setLassoOn(false);
      selectWithin(pts, additive);
    },
    [clearLasso, selectWithin],
  );

  /**
   * 지도를 누르면 점을 찍는다.
   * 첫 점을 다시 누르면 영역을 닫는다 — 손으로도 쓸 수 있게 16px 까지 봐 준다.
   */
  const addLassoPoint = useCallback(
    (coord: any, additive: boolean) => {
      const pts = lassoPtsRef.current;
      const map = mapRef.current;
      const proj = map?.getProjection();
      if (pts.length >= 3 && typeof proj?.fromCoordToOffset === "function") {
        const naver = window.naver;
        const first = proj.fromCoordToOffset(new naver.maps.LatLng(pts[0][0], pts[0][1]));
        const here = proj.fromCoordToOffset(coord);
        if (Math.hypot(first.x - here.x, first.y - here.y) <= 16) {
          completeLasso(additive);
          return;
        }
      }
      lassoPtsRef.current = [...pts, [coord.lat(), coord.lng()]];
      setLassoCount(lassoPtsRef.current.length);
    },
    [completeLasso],
  );
  const addPointRef = useRef(addLassoPoint);
  addPointRef.current = addLassoPoint;

  /* 배경(필지가 없는 자리)을 눌렀을 때도 점이 찍히게 한다 */
  useEffect(() => {
    if (!ready) return;
    const naver = window.naver;
    const listener = naver.maps.Event.addListener(mapRef.current, "click", (e: any) => {
      if (!lassoOnRef.current) return;
      const ev = e.domEvent as MouseEvent | undefined;
      addPointRef.current(e.coord, Boolean(ev?.shiftKey || ev?.ctrlKey || ev?.metaKey));
    });
    return () => naver.maps.Event.removeListener(listener);
  }, [ready]);

  /* 모드를 끄면 찍던 점도 버린다 */
  useEffect(() => {
    if (!lassoOn) clearLasso();
  }, [lassoOn, clearLasso]);

  const lassoModeRef = useRef(onLassoModeChange);
  lassoModeRef.current = onLassoModeChange;
  useEffect(() => lassoModeRef.current(lassoOn), [lassoOn]);

  /**
   * 찍은 점을 지도 위에 그린다.
   * 도형을 지도 오버레이로 두면 지도를 움직이거나 확대해도 제자리에 붙어 있다.
   */
  useEffect(() => {
    if (!ready) return;
    const naver = window.naver;
    const map = mapRef.current;
    const pts = lassoPtsRef.current;

    for (const d of lassoDotsRef.current) d.setMap(null);
    lassoDotsRef.current = [];

    if (!pts.length) {
      lassoPolyRef.current?.setMap(null);
      lassoPolyRef.current = null;
      return;
    }

    const paths = pts.map(([lat, lng]) => new naver.maps.LatLng(lat, lng));
    if (!lassoPolyRef.current) {
      lassoPolyRef.current = new naver.maps.Polygon({
        map,
        paths: [paths],
        fillColor: SELECTED_FILL,
        fillOpacity: 0.18,
        strokeColor: SELECTED_FILL,
        strokeWeight: 2.5,
        strokeStyle: "shortdash",
        // 점을 찍는 동안 이 도형이 클릭을 가로채면 다음 점을 찍을 수 없다
        clickable: false,
        zIndex: 300000,
      });
    } else {
      lassoPolyRef.current.setPaths([paths]);
      lassoPolyRef.current.setMap(map);
    }

    lassoDotsRef.current = pts.map(([lat, lng], i) => {
      // 첫 점은 크게 — 여기를 다시 누르면 닫힌다는 표시다
      const size = i === 0 ? 16 : 10;
      return new naver.maps.Marker({
        map,
        position: new naver.maps.LatLng(lat, lng),
        icon: {
          content: `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:${
            i === 0 ? "#fff" : SELECTED_FILL
          };border:3px solid ${SELECTED_FILL};box-sizing:border-box;box-shadow:0 1px 3px rgba(0,0,0,.45)"></div>`,
          anchor: new naver.maps.Point(size / 2, size / 2),
        },
        clickable: false,
        zIndex: 300001,
      });
    });
  }, [ready, lassoCount]);

  /* 컴포넌트가 사라질 때 그리던 도형도 걷는다 */
  useEffect(
    () => () => {
      lassoPolyRef.current?.setMap(null);
      for (const d of lassoDotsRef.current) d.setMap(null);
      lassoDotsRef.current = [];
    },
    [],
  );

  const centerOn = useCallback((loc: MyLocation) => {
    const map = mapRef.current;
    if (!map) return;
    map.setZoom(Math.max(map.getZoom(), 17), true);
    map.panTo(new window.naver.maps.LatLng(loc.lat, loc.lng));
  }, []);

  const stopWatching = useCallback(() => {
    if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
    watchIdRef.current = null;
  }, []);

  /**
   * 내 위치 버튼.
   * 현장을 걸으며 보는 용도라 한 번 받고 끝내지 않고 계속 따라간다.
   * 이미 따라가는 중에 누르면 지도만 내 위치로 다시 옮긴다.
   */
  const locate = useCallback(() => {
    if (watchIdRef.current !== null && lastFixRef.current) {
      centerOn(lastFixRef.current);
      return;
    }
    if (watchIdRef.current !== null) return; // 첫 위치를 기다리는 중
    // 위치 API 는 HTTPS(또는 localhost)에서만 열린다
    if (!window.isSecureContext || !("geolocation" in navigator)) {
      noticeRef.current("⚠️ 이 브라우저에서는 위치를 확인할 수 없습니다 (HTTPS 접속 필요).");
      return;
    }

    setLocating(true);
    centerOnFixRef.current = true;
    watchIdRef.current = navigator.geolocation.watchPosition(
      (p) => {
        const loc = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy };
        lastFixRef.current = loc;
        setMyLocation(loc);
        setLocating(false);
        if (centerOnFixRef.current) {
          centerOnFixRef.current = false;
          centerOn(loc);
        }
      },
      (err) => {
        // 이미 위치를 받은 뒤 실내 등에서 잠깐 끊기는 것은 무시하고 마지막 위치를 둔다
        if (err.code !== err.PERMISSION_DENIED && lastFixRef.current) return;
        stopWatching();
        lastFixRef.current = null;
        setMyLocation(null);
        setLocating(false);
        noticeRef.current(`⚠️ ${GEO_ERRORS[err.code] ?? "현재 위치를 확인할 수 없습니다."}`);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 },
    );
  }, [centerOn, stopWatching]);

  useEffect(() => stopWatching, [stopWatching]);

  /* 내 위치 점과 오차 범위 원 */
  useEffect(() => {
    if (!ready) return;
    const naver = window.naver;
    if (!myLocation) {
      myMarkerRef.current?.setMap(null);
      myAccuracyRef.current?.setMap(null);
      myMarkerRef.current = null;
      myAccuracyRef.current = null;
      return;
    }
    // GPS 좌표는 배경지도와 같은 기준이라 필지처럼 shiftLng 로 옮기지 않는다
    const at = new naver.maps.LatLng(myLocation.lat, myLocation.lng);
    if (!myMarkerRef.current) {
      myAccuracyRef.current = new naver.maps.Circle({
        map: mapRef.current,
        center: at,
        radius: myLocation.accuracy,
        fillColor: MY_LOCATION_COLOR,
        fillOpacity: 0.1,
        strokeColor: MY_LOCATION_COLOR,
        strokeOpacity: 0.35,
        strokeWeight: 1,
        // 필지 클릭을 가로채지 않게 한다
        clickable: false,
        zIndex: 200000,
      });
      myMarkerRef.current = new naver.maps.Marker({
        map: mapRef.current,
        position: at,
        icon: {
          content: `<div style="width:18px;height:18px;border-radius:9999px;background:${MY_LOCATION_COLOR};border:3px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.2),0 1px 4px rgba(0,0,0,.45)"></div>`,
          anchor: new naver.maps.Point(9, 9),
        },
        clickable: false,
        zIndex: 200001,
      });
    } else {
      myMarkerRef.current.setPosition(at);
      myAccuracyRef.current.setCenter(at);
      myAccuracyRef.current.setRadius(myLocation.accuracy);
    }
  }, [ready, myLocation]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-900 p-8">
        <div className="max-w-md rounded-xl border border-red-500/40 bg-red-500/10 p-5 text-sm">
          <div className="mb-2 font-semibold text-red-300">네이버 지도를 불러오지 못했습니다</div>
          <p className="text-slate-300">{error}</p>
          <p className="mt-3 text-xs leading-relaxed text-slate-400">
            네이버 클라우드 플랫폼 콘솔의 Maps 애플리케이션에서 <code>Web 서비스 URL</code> 에
            현재 접속 주소가 등록돼 있는지 확인하세요.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />

      {locateSlot &&
        createPortal(
          <button
            type="button"
            onClick={locate}
            title="내 위치"
            aria-label="내 위치"
            aria-pressed={myLocation !== null}
            // 확대·축소 컨트롤(폭 28px + 테두리 1px, 바깥 여백 10px)과 줄을 맞춘다
            className={`ml-[10px] flex h-[30px] w-[30px] items-center justify-center border border-[#444] bg-white transition active:bg-slate-100 ${
              myLocation || locating ? "text-blue-600" : "text-slate-600"
            }`}
          >
            {/* 조준선 모양 — 위치를 받는 동안은 깜빡인다 */}
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              className={`h-[18px] w-[18px] ${locating ? "animate-pulse" : ""}`}
            >
              <circle cx="12" cy="12" r="7" />
              <circle
                cx="12"
                cy="12"
                r="2.5"
                fill={myLocation ? "currentColor" : "none"}
              />
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
            </svg>
          </button>,
          locateSlot,
        )}

      {lassoSlot &&
        createPortal(
          <button
            type="button"
            onClick={() => setLassoOn((v) => !v)}
            title="마법 선택 — 영역을 그려 필지를 한꺼번에 선택"
            aria-label="마법 선택"
            aria-pressed={lassoOn}
            /* 오버레이(z-400)보다 위에 둬야 켠 뒤에도 이 버튼으로 끌 수 있다 */
            className={`relative z-[500] ml-[10px] flex h-[30px] w-[30px] items-center justify-center border border-[#444] transition ${
              lassoOn ? "bg-emerald-500 text-white" : "bg-white text-slate-600 active:bg-slate-100"
            }`}
          >
            {/* 올가미 — 점선 고리에 꼬리와 매듭 */}
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              className="h-[18px] w-[18px]"
            >
              <path d="M12 3.5c4.7 0 8.5 2.6 8.5 5.8S16.7 15 12 15s-8.5-2.6-8.5-5.7S7.3 3.5 12 3.5z" strokeDasharray="3 2.6" />
              <path d="M9.4 14.7c-.7 1.6-.3 3.4.9 4.5" />
              <circle cx="11" cy="20.7" r="1.5" />
            </svg>
          </button>,
          lassoSlot,
        )}

      {/*
        영역 도구 조작줄.
        지도를 덮는 요약 카드·필지 카드가 z-1000 이라 그보다 위에 둬야 가려지지 않는다.
        자리는 아래 가운데 — 관리자 안내줄과 같은 자리라 이 앱에서 "지금 할 일" 이 뜨는
        곳이고, 손으로 쓸 때 엄지가 닿는다. 버튼은 상태에 따라 사라지게 두지 않고
        흐리게만 한다 — 있다 없다 하면 어디 있는지 찾게 된다.
      */}
      {lassoOn && (
        <div className="pointer-events-none absolute bottom-6 left-1/2 z-[1200] w-[min(92vw,400px)] -translate-x-1/2">
          <div className="pointer-events-auto rounded-2xl border border-emerald-400/60 bg-slate-900/95 px-3 py-2.5 shadow-2xl ring-1 ring-black/40 backdrop-blur">
            <div className="text-center text-[11px] leading-snug text-slate-300">
              {lassoCount === 0
                ? "지도를 눌러 점을 찍으세요"
                : lassoCount < 3
                  ? `점 ${lassoCount}개 · 3개부터 면이 됩니다`
                  : `점 ${lassoCount}개 · 첫 점을 다시 눌러도 닫힙니다`}
            </div>
            <div className="mt-2 flex items-center gap-1.5">
              <button
                type="button"
                disabled={lassoCount === 0}
                onClick={() => {
                  lassoPtsRef.current = lassoPtsRef.current.slice(0, -1);
                  setLassoCount(lassoPtsRef.current.length);
                }}
                className="shrink-0 rounded-xl border border-slate-600 px-2.5 py-1.5 text-xs text-slate-200 transition hover:bg-slate-800 disabled:opacity-35"
              >
                되돌리기
              </button>
              <button
                type="button"
                disabled={lassoCount < 3}
                onClick={(e) => completeLasso(e.shiftKey || e.ctrlKey || e.metaKey)}
                className="min-w-0 flex-1 rounded-xl bg-emerald-500 px-3 py-1.5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-35"
              >
                완료
              </button>
              <button
                type="button"
                onClick={() => setLassoOn(false)}
                className="shrink-0 rounded-xl border border-slate-600 px-2.5 py-1.5 text-xs text-slate-200 transition hover:bg-slate-800"
              >
                끄기
              </button>
            </div>
          </div>
        </div>
      )}

      {ready && (
        <div className="pointer-events-none absolute bottom-4 right-4 z-[500] rounded-lg bg-slate-900/80 px-2.5 py-1 text-[11px] text-slate-400 backdrop-blur">
          화면에 {drawn.toLocaleString()}필지
          {skipped > 0 && (
            <span className="text-amber-400">
              {" "}
              · 미지정 {skipped.toLocaleString()}필지는 확대해야 보입니다
            </span>
          )}
        </div>
      )}

      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900 text-sm text-slate-400">
          네이버 지도를 불러오는 중…
        </div>
      )}
    </div>
  );
}
