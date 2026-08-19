"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Basemap } from "./MapView";
import AdminLogin from "./AdminLogin";
import ConsentSummary from "./ConsentSummary";
import ParcelActions from "./ParcelActions";
import ParcelBrief from "./ParcelBrief";
import ParcelPanel from "./ParcelPanel";
import type { ConsentMap } from "@/lib/consent";
import type { ParcelCollection, ParcelProps, Zone, ZoneMutation } from "@/lib/types";

const loading = (
  <div className="flex h-full items-center justify-center bg-slate-900 text-sm text-slate-400">
    지도를 불러오는 중…
  </div>
);

const MapView = dynamic(() => import("./MapView"), { ssr: false, loading: () => loading });
const NaverMapView = dynamic(() => import("./NaverMapView"), {
  ssr: false,
  loading: () => loading,
});

const EMPTY: ParcelCollection = { type: "FeatureCollection", features: [] };

export default function AppShell({
  initialZones,
  boundary,
  consent,
  dataError,
  naverClientId,
  naverKeyParam,
}: {
  initialZones: Zone[];
  boundary: { geometry: { coordinates: number[][][] } };
  /** 서버가 MongoDB 에서 읽어 내려준 참여의향서 명부 */
  consent: ConsentMap;
  /** DB 조회에 실패했을 때의 안내 (정상이면 null) */
  dataError: string | null;
  naverClientId: string;
  naverKeyParam: string;
}) {
  const [parcels, setParcels] = useState<ParcelCollection>(EMPTY);
  const [parcelError, setParcelError] = useState<string | null>(null);
  const [zones, setZones] = useState<Zone[]>(initialZones);
  const [visibleZoneIds, setVisibleZoneIds] = useState<Set<string>>(
    () => new Set(initialZones.map((z) => z.id)),
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adminMode, setAdminMode] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [activeZoneId, setActiveZoneId] = useState(initialZones[0]?.id ?? "");
  /** 참여의향서 제출률로 필지를 색칠하는 레이어 — 이 지도의 주 용도라 기본으로 켠다 */
  const [showConsent, setShowConsent] = useState(true);
  const [showCadastral, setShowCadastral] = useState(false);
  const [basemap, setBasemap] = useState<Basemap>("dark");
  const [flyTo, setFlyTo] = useState<[number, number] | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const useNaver = Boolean(naverClientId);

  /* 필지는 정적 파일로 받는다 (브라우저 캐시 이용) */
  useEffect(() => {
    let cancelled = false;
    fetch("/parcels.json")
      .then((r) => {
        if (!r.ok) throw new Error(`필지 데이터를 불러오지 못했습니다 (HTTP ${r.status})`);
        return r.json();
      })
      .then((d: ParcelCollection) => !cancelled && setParcels(d))
      .catch((e) => !cancelled && setParcelError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, []);

  /* 새로고침해도 로그인 상태(쿠키)를 이어받는다 */
  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin")
      .then((r) => r.json())
      .then((d: { admin: string | null }) => !cancelled && setAdminMode(Boolean(d.admin)))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  /* Esc 로 선택 해제 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setSelected((prev) => (prev.size ? new Set() : prev));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /** pnu → 소속 구역 */
  const zoneOf = useMemo(() => {
    const m = new Map<string, Zone>();
    for (const z of zones) for (const p of z.parcels) m.set(p, z);
    return m;
  }, [zones]);

  const propsOf = useMemo(() => {
    const m = new Map<string, ParcelProps>();
    for (const f of parcels.features) m.set(f.properties.pnu, f.properties);
    return m;
  }, [parcels]);

  const handleParcelClick = useCallback((props: ParcelProps, additive: boolean) => {
    setSelected((prev) => {
      const next = additive ? new Set(prev) : new Set<string>();
      if (additive && prev.has(props.pnu)) next.delete(props.pnu);
      else next.add(props.pnu);
      return next;
    });
    setFlyTo(null);
  }, []);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  }, []);

  /** 구역 목록을 갱신하는 모든 요청의 공통 처리 */
  const send = useCallback(
    async (input: RequestInfo, init: RequestInit) => {
      setBusy(true);
      try {
        const res = await fetch(input, init);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "저장에 실패했습니다");
        setZones(data as Zone[]);
        return data as Zone[];
      } catch (e) {
        flash(`⚠️ ${(e as Error).message}`);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [flash],
  );

  const mutate = useCallback(
    (m: ZoneMutation) =>
      send("/api/zones", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(m),
      }),
    [send],
  );

  const addSelectedToZone = useCallback(async () => {
    if (!selected.size || !activeZoneId) return;
    const zone = zones.find((z) => z.id === activeZoneId);
    const ok = await mutate({ action: "add", zoneId: activeZoneId, pnus: [...selected] });
    if (ok) flash(`${selected.size}필지를 ${zone?.name}에 편입했습니다.`);
  }, [selected, activeZoneId, zones, mutate, flash]);

  const removeSelectedFromZones = useCallback(async () => {
    if (!selected.size) return;
    const byZone = new Map<string, string[]>();
    for (const pnu of selected) {
      const z = zoneOf.get(pnu);
      if (!z) continue;
      byZone.set(z.id, [...(byZone.get(z.id) ?? []), pnu]);
    }
    if (!byZone.size) {
      flash("선택한 필지는 어떤 구역에도 속해있지 않습니다.");
      return;
    }
    let moved = 0;
    for (const [zoneId, pnus] of byZone) {
      const ok = await mutate({ action: "remove", zoneId, pnus });
      if (ok) moved += pnus.length;
    }
    if (moved) flash(`${moved}필지를 구역에서 제외했습니다.`);
  }, [selected, zoneOf, mutate, flash]);

  const setZoneOwners = useCallback(
    async (zoneId: string, owners: number) => {
      const ok = await mutate({ action: "setOwners", zoneId, owners });
      if (ok) flash(`총 소유자 수를 ${owners.toLocaleString()}명으로 저장했습니다.`);
    },
    [mutate, flash],
  );

  /** 관리자 아이콘: 꺼져 있으면 로그인 창을, 켜져 있으면 로그아웃 */
  const toggleAdmin = useCallback(async () => {
    if (!adminMode) {
      setLoginOpen(true);
      return;
    }
    await fetch("/api/admin", { method: "DELETE" }).catch(() => {});
    setAdminMode(false);
    flash("관리자 모드를 껐습니다.");
  }, [adminMode, flash]);

  const focusParcel = useCallback(
    (props: ParcelProps, additive = false) => {
      handleParcelClick(props, additive);
      setFlyTo(props.centroid);
    },
    [handleParcelClick],
  );

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="flex shrink-0 items-center gap-4 border-b border-slate-800 bg-slate-900/80 px-5 py-3 backdrop-blur">
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold tracking-tight">
            논현동 공도복
          </h1>
          <p className="truncate text-xs text-slate-400">
            논현1동 재개발 도심공공주택복합사업
          </p>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {useNaver ? (
            <>
              <button
                onClick={() => setShowCadastral((v) => !v)}
                className={`rounded-lg px-3 py-1.5 text-xs transition ${
                  showCadastral
                    ? "bg-slate-700 text-white"
                    : "border border-slate-700 text-slate-400 hover:text-slate-200"
                }`}
              >
                지적편집도
              </button>
            </>
          ) : (
            <div className="flex overflow-hidden rounded-lg border border-slate-700 text-xs">
              {(["dark", "light"] as Basemap[]).map((b) => (
                <button
                  key={b}
                  onClick={() => setBasemap(b)}
                  className={`px-3 py-1.5 transition ${
                    basemap === b
                      ? "bg-slate-700 text-white"
                      : "bg-slate-900 text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {b === "dark" ? "어두운 지도" : "밝은 지도"}
                </button>
              ))}
            </div>
          )}

          <button
            onClick={() => setShowConsent((v) => !v)}
            className={`rounded-lg px-3 py-1.5 text-xs transition ${
              showConsent
                ? "bg-emerald-600 text-white"
                : "border border-slate-700 text-slate-400 hover:text-slate-200"
            }`}
          >
            참여의향서
          </button>

          <button
            onClick={toggleAdmin}
            title={adminMode ? "관리자 모드 끄기" : "관리자 모드 켜기"}
            aria-label="관리자 모드"
            aria-pressed={adminMode}
            className={`rounded-lg p-1.5 transition ${
              adminMode
                ? "bg-emerald-500 text-slate-950 hover:bg-emerald-400"
                : "border border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            }`}
          >
            {/* 방패 안에 체크 — 권한이 열린 상태를 나타낸다 */}
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4"
            >
              <path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3z" />
              <path d="M9 12l2 2 4-4" />
            </svg>
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1">
          {useNaver ? (
            <NaverMapView
              consent={consent}
              clientId={naverClientId}
              keyParam={naverKeyParam}
              parcels={parcels}
              boundary={boundary}
              zoneOf={zoneOf}
              visibleZoneIds={visibleZoneIds}
              selected={selected}
              showConsent={showConsent}
              showCadastral={showCadastral}
              flyTo={flyTo}
              onParcelClick={handleParcelClick}
            />
          ) : (
            <MapView
              consent={consent}
              parcels={parcels}
              boundary={boundary}
              zones={zones}
              zoneOf={zoneOf}
              visibleZoneIds={visibleZoneIds}
              selected={selected}
              showConsent={showConsent}
              basemap={basemap}
              flyTo={flyTo}
              onParcelClick={handleParcelClick}
            />
          )}

          <div className="pointer-events-none absolute bottom-6 left-1/2 z-[1000] flex -translate-x-1/2 flex-col items-center gap-2 text-center">
            <div className="md:hidden">
              <ParcelBrief
                selected={selected}
                propsOf={propsOf}
                zoneOf={zoneOf}
                consent={consent}
                onClear={() => setSelected(new Set())}
              />
            </div>

            {adminMode &&
              (selected.size > 0 ? (
                <ParcelActions
                  selected={selected}
                  zoneOf={zoneOf}
                  busy={busy}
                  onAdd={addSelectedToZone}
                  onRemove={removeSelectedFromZones}
                />
              ) : (
                <div className="pointer-events-auto inline-block rounded-full bg-emerald-500/90 px-4 py-1.5 text-xs font-medium text-slate-950 shadow-lg">
                  필지를 클릭해 선택 · Shift 또는 Ctrl 클릭으로 여러 필지 선택
                </div>
              ))}
            {toast && (
              <div className="pointer-events-auto rounded-full bg-slate-800 px-4 py-1.5 text-xs text-slate-100 shadow-lg ring-1 ring-slate-700">
                {toast}
              </div>
            )}
          </div>

          {/* 지도 오른쪽 플로팅 열 — 제출률 요약 / 지번 검색 / 선택 필지.
              좁은 화면에서는 지도를 다 덮어버려 숨기고 아래 간략 정보로 대신한다 */}
          <div className="pointer-events-none absolute bottom-4 right-4 top-4 z-[1000] hidden w-[280px] flex-col gap-2 md:flex">
            {dataError && (
              <div className="pointer-events-auto shrink-0 rounded-xl border border-red-500/40 bg-slate-900/90 px-3 py-2.5 text-xs leading-snug text-red-300 backdrop-blur">
                {dataError}
              </div>
            )}

            {parcelError && (
              <div className="pointer-events-auto shrink-0 rounded-xl border border-red-500/40 bg-slate-900/90 px-3 py-2.5 text-xs text-red-300 backdrop-blur">
                {parcelError}
              </div>
            )}

            {showConsent && (
              <ConsentSummary
                zones={zones}
                consent={consent}
                visibleZoneIds={visibleZoneIds}
                propsOf={propsOf}
                adminMode={adminMode}
                busy={busy}
                onSetOwners={setZoneOwners}
              />
            )}

            <ParcelPanel
              parcels={parcels}
              consent={consent}
              zoneOf={zoneOf}
              propsOf={propsOf}
              selected={selected}
              setSelected={setSelected}
              onFocusParcel={focusParcel}
            />
          </div>

        </main>
      </div>

      {loginOpen && (
        <AdminLogin
          onClose={() => setLoginOpen(false)}
          onSuccess={() => {
            setLoginOpen(false);
            setAdminMode(true);
            flash("관리자 모드를 켰습니다.");
          }}
        />
      )}
    </div>
  );
}
