"use client";

import { useMemo } from "react";
import { MapContainer, Polygon, TileLayer, Tooltip, useMap } from "react-leaflet";
import type { LatLngExpression } from "leaflet";
import {
  consentColor,
  consentFillOpacity,
  consentStrokeOpacity,
} from "@/lib/consent";
import type { ConsentMap } from "@/lib/consent";
import { shiftLng } from "@/lib/geo";
import type { ParcelCollection, ParcelProps, Zone } from "@/lib/types";

/** 지도를 처음 열었을 때의 중심 — 논현동 177-14 필지 */
const MAP_CENTER: LatLngExpression = [37.508792, 127.029892];

/** 선택한 필지를 칠하는 색 */
const SELECTED_FILL = "#22c55e";

const BASEMAPS = {
  dark: {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
  light: {
    url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
} as const;

export type Basemap = keyof typeof BASEMAPS;

type Ring = LatLngExpression[];

type PreparedParcel = {
  props: ParcelProps;
  ring: Ring;
};

function FlyTo({ target }: { target: [number, number] | null }) {
  const map = useMap();
  if (target) map.flyTo(target, Math.max(map.getZoom(), 18), { duration: 0.7 });
  return null;
}

export default function MapView({
  parcels,
  boundary,
  consent: consentMap,
  zones,
  zoneOf,
  visibleZoneIds,
  selected,
  showConsent,
  basemap,
  flyTo,
  onParcelClick,
}: {
  parcels: ParcelCollection;
  boundary: { geometry: { coordinates: number[][][] } };
  consent: ConsentMap;
  zones: Zone[];
  zoneOf: Map<string, Zone>;
  visibleZoneIds: Set<string>;
  selected: Set<string>;
  /** 참여의향서 제출률로 색칠하기 */
  showConsent: boolean;
  basemap: Basemap;
  flyTo: [number, number] | null;
  onParcelClick: (props: ParcelProps, additive: boolean) => void;
}) {
  const prepared = useMemo<PreparedParcel[]>(
    () =>
      parcels.features.map((f) => ({
        props: f.properties,
        // 링 전체 — 두 번째 링부터는 Leaflet 이 구멍으로 그린다
        ring: f.geometry.coordinates.map((r) =>
          r.map(([lng, lat]) => [lat, shiftLng(lng)] as LatLngExpression),
        ) as unknown as Ring,
      })),
    [parcels],
  );

  const boundaryRing = useMemo<Ring>(
    () => boundary.geometry.coordinates[0].map(([lng, lat]) => [lat, lng] as LatLngExpression),
    [boundary],
  );

  const tile = BASEMAPS[basemap];

  return (
    <MapContainer
      center={MAP_CENTER}
      zoom={16}
      minZoom={13}
      maxZoom={19}
      className="h-full w-full"
      preferCanvas
      zoomControl
    >
      <TileLayer key={basemap} url={tile.url} attribution={tile.attribution} />

      <Polygon
        positions={boundaryRing}
        pathOptions={{
          color: "#94a3b8",
          weight: 2,
          dashArray: "6 6",
          fill: false,
          interactive: false,
        }}
      />

      {prepared.map(({ props, ring }) => {
        const zone = zoneOf.get(props.pnu);
        const inVisibleZone = zone ? visibleZoneIds.has(zone.id) : false;
        const isSelected = selected.has(props.pnu);

        const consent = showConsent ? consentMap[props.pnu] : undefined;

        /**
         * 구역에 편입된 필지는 명부에 한 호도 없어도 0% 로 칠한다.
         * 회색으로 두면 "자료 없음" 과 "아무도 안 냈음" 이 구분되지 않는다.
         */
        // 반올림하지 않는다 — 0.4% 가 0% 로 접히면 제출이 있는 필지가 빨강이 된다
        const consentRatio = consent
          ? (consent.submitted / consent.total) * 100
          : showConsent && inVisibleZone
            ? 0
            : null;

        const base =
          consentRatio !== null
            ? {
                // 제출률 색이 구역 색보다 우선한다
                color: consentColor(consentRatio),
                // 명부에 제출 기록이 있는 필지는 테두리를 한 겹 굵게 해 눈에 띄게 한다
                weight: consent ? 2 : 1,
                opacity: consentStrokeOpacity(consentRatio),
                fillColor: consentColor(consentRatio),
                fillOpacity: consentFillOpacity(consentRatio),
              }
          : showConsent
          ? {
              // 제출률 레이어가 켜져 있으면 명부에 없는 필지는 배경으로 물린다
              color: "#94a3b8",
              weight: 0.6,
              fillColor: "#64748b",
              fillOpacity: 0.1,
            }
          : inVisibleZone
          ? {
              color: zone!.color,
              weight: 1,
              fillColor: zone!.color,
              fillOpacity: 0.45,
            }
          : {
              color: "#64748b",
              weight: 0.5,
              fillColor: "#475569",
              fillOpacity: 0.12,
            };

        return (
          <Polygon
            key={props.pnu}
            positions={ring}
            pathOptions={
              // 선택한 필지는 제출률·구역 색과 무관하게 항상 녹색 + 검은 테두리로 표시한다.
              isSelected
                ? {
                    ...base,
                    fillColor: SELECTED_FILL,
                    fillOpacity: 0.65,
                    color: "#000000",
                    weight: 3.5,
                    opacity: 1,
                    dashArray: "4 3",
                  }
                : base
            }
            eventHandlers={{
              click: (e) => {
                const ev = e.originalEvent as MouseEvent;
                onParcelClick(props, ev.shiftKey || ev.ctrlKey || ev.metaKey);
              },
            }}
          >
            <Tooltip direction="top" opacity={1} sticky>
              <div className="text-[11px] leading-tight">
                <div className="font-semibold">논현동 {props.jibun}</div>
                <div className="text-slate-600">
                  {props.category} · {props.area}㎡
                </div>
                <div className="text-slate-500">{zone ? zone.name : "구역 미지정"}</div>
                {consent && (
                  <div className="font-medium text-emerald-700">
                    참여의향서 {consent.submitted}/{consent.total}호 (
                    {Math.round(consentRatio!)}%)
                  </div>
                )}
              </div>
            </Tooltip>
          </Polygon>
        );
      })}

      <FlyTo target={flyTo} />
    </MapContainer>
  );
}
