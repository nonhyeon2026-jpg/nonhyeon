"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Basemap } from "./MapView";
import AdminLogin from "./AdminLogin";
import ConsentSummary from "./ConsentSummary";
import ParcelActions from "./ParcelActions";
import ParcelBrief from "./ParcelBrief";
import ParcelPanel from "./ParcelPanel";
import SelectionSummary from "./SelectionSummary";
import OwnerLegend from "./OwnerLegend";
import type { OwnerMark } from "./ownerBadge";
import { blockConsent, computeBlocks, parcelAnchor } from "@/lib/blocks";
import BlockLegend from "./BlockLegend";
import { BLOCK_ROW_KEYS } from "./blockBadge";
import type { BlockRowKey } from "./blockBadge";
import type { BlockConsent } from "@/lib/blocks";
import { applyConsent, removeConsent as dropConsent, ownerBasisOf } from "@/lib/consent";
import type { ConsentMap } from "@/lib/consent";
import type {
  ConsentInfo,
  ConsentInput,
  ParcelCollection,
  ParcelProps,
  Zone,
  ZoneMutation,
} from "@/lib/types";

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
  consent: initialConsent,
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
  /** 관리자가 명부를 고치면 여기서 바로 갈아끼운다 — 새로고침 없이 지도 색까지 따라간다 */
  const [consent, setConsent] = useState<ConsentMap>(initialConsent);
  const [parcelError, setParcelError] = useState<string | null>(null);
  const [zones, setZones] = useState<Zone[]>(initialZones);
  const [visibleZoneIds, setVisibleZoneIds] = useState<Set<string>>(
    () => new Set(initialZones.map((z) => z.id)),
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** 선택 영역 제출률의 분모로 쓸 소유자 수. 구역과 달리 저장하지 않는 임시값이다 */
  const [selectionOwners, setSelectionOwners] = useState("");
  /** 지도에서 영역을 찍는 중 — 그동안은 지도를 덮는 카드를 치운다 */
  const [drawing, setDrawing] = useState(false);
  const [adminMode, setAdminMode] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [activeZoneId, setActiveZoneId] = useState(initialZones[0]?.id ?? "");
  /**
   * 지도에 얹는 숫자 표시. 블록별(면적 동의율)과 소유자(지번별 추정 소유자 수)는 둘 다
   * 필지 위에 숫자를 띄워 겹치면 읽을 수 없으므로 하나만 켠다.
   */
  const [overlay, setOverlay] = useState<"none" | "blocks" | "owners">("none");
  const showBlocks = overlay === "blocks";
  /** 블록 표시에 띄울 줄. 하나는 늘 남겨 둔다 */
  const [blockRows, setBlockRows] = useState<BlockRowKey[]>(BLOCK_ROW_KEYS);
  const toggleBlockRow = (k: BlockRowKey) =>
    setBlockRows((v) =>
      v.includes(k)
        ? v.length > 1
          ? v.filter((x) => x !== k)
          : v
        : BLOCK_ROW_KEYS.filter((x) => x === k || v.includes(x)),
    );
  const showOwners = overlay === "owners";
  const toggleOverlay = (o: "blocks" | "owners") => setOverlay((v) => (v === o ? "none" : o));
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

  /* 선택이 바뀌면 직접 넣은 소유자 수는 그 선택의 값이 아니므로 지운다 */
  useEffect(() => setSelectionOwners(""), [selected]);

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

  /** 보이는 구역의 블록. 지적도 모양에만 달려 있어 명부가 바뀌어도 다시 묶지 않는다 */
  const blocks = useMemo(() => {
    if (!showBlocks) return [];
    const pnus = new Set<string>();
    for (const z of zones) if (visibleZoneIds.has(z.id)) for (const p of z.parcels) pnus.add(p);
    return computeBlocks(parcels.features, pnus);
  }, [showBlocks, zones, visibleZoneIds, parcels]);

  const blockRatios = useMemo<BlockConsent[] | null>(
    () => {
      if (!showBlocks) return null;
      // 소유자는 구역 범위로 센다 — 소유자 표시의 숫자와 같은 값이 되도록
      const scopeOf = new Map<string, Set<string>>();
      for (const z of zones) {
        if (!visibleZoneIds.has(z.id)) continue;
        const scope = new Set(z.parcels);
        for (const p of z.parcels) scopeOf.set(p, scope);
      }
      return blockConsent(blocks, propsOf, consent, scopeOf);
    },
    [showBlocks, blocks, propsOf, consent, zones, visibleZoneIds],
  );

  /**
   * 필지 한가운데 자리. 지적도 모양에만 달려 있어 한 번 구하면 기억해 둔다.
   * 전 필지를 한꺼번에 구하면 큰 도로 필지 때문에 10초 넘게 화면이 멈추므로,
   * 숫자를 띄울 구역 필지만 그때그때 구한다.
   */
  const anchorCache = useRef<{ parcels: ParcelCollection; map: Map<string, [number, number]> }>();
  const featureOf = useMemo(() => {
    const m = new Map<string, ParcelCollection["features"][number]>();
    for (const f of parcels.features) m.set(f.properties.pnu, f);
    return m;
  }, [parcels]);
  const anchorOf = useCallback(
    (pnu: string) => {
      if (anchorCache.current?.parcels !== parcels) {
        anchorCache.current = { parcels, map: new Map() };
      }
      const cache = anchorCache.current.map;
      let a = cache.get(pnu);
      if (!a) {
        const f = featureOf.get(pnu);
        if (!f) return undefined;
        a = parcelAnchor(f);
        cache.set(pnu, a);
      }
      return a;
    },
    [parcels, featureOf],
  );

  /** 보이는 구역 필지마다 추정 소유자 수와 판별 원인 */
  const ownerMarks = useMemo<OwnerMark[] | null>(() => {
    if (!showOwners) return null;
    const marks: OwnerMark[] = [];
    for (const z of zones) {
      if (!visibleZoneIds.has(z.id)) continue;
      // 구역 카드(summarizeZone)와 같은 범위로 세야 지도 합계가 카드와 맞는다
      const scope = new Set(z.parcels);
      for (const pnu of z.parcels) {
        const props = propsOf.get(pnu);
        const basis = ownerBasisOf(pnu, propsOf, consent, scope);
        const anchor = anchorOf(pnu);
        if (!props || !basis || !anchor) continue;
        marks.push({ ...basis, pnu, jibun: props.jibun, anchor });
      }
    }
    return marks;
  }, [showOwners, anchorOf, zones, visibleZoneIds, propsOf, consent]);

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

  /**
   * 마법 선택 — 그린 선 안에 온전히 들어온 구역 필지를 한꺼번에 고른다.
   * 보조키를 누르고 그리면 기존 선택에 더하고, 아니면 새로 고른다 (클릭과 같은 규칙).
   */
  const handleLassoSelect = useCallback(
    (pnus: string[], additive: boolean) => {
      setSelected((prev) => {
        const next = additive ? new Set(prev) : new Set<string>();
        for (const p of pnus) next.add(p);
        return next;
      });
      setFlyTo(null);
      flash(
        pnus.length
          ? `${pnus.length.toLocaleString()}필지를 선택했습니다.`
          : "선 안에 온전히 들어온 구역 필지가 없습니다. 조금 넓게 그려보세요.",
      );
    },
    [flash],
  );

  /** 블록 표시를 누르면 그 블록 필지를 골라 오른쪽 카드에서 숫자를 보게 한다 */
  const handleBlockClick = useCallback(
    (block: BlockConsent) => {
      setSelected(new Set(block.pnus));
      setFlyTo(null);
      flash(
        `블록 ${block.pnus.length}필지 · 면적 동의율 ${block.areaRatio}% ` +
          `(${Math.round(block.consentedArea).toLocaleString()}/${Math.round(block.area).toLocaleString()}㎡) · ` +
          `소유자 동의율 ${block.ownerRatio}% (${block.people}/${block.owners}명)`,
      );
    },
    [flash],
  );

  /** 소유자 수 표시를 누르면 그 필지를 고른다 — 판별 원인은 필지 카드에 자세히 나온다 */
  const handleOwnerClick = useCallback(
    (mark: OwnerMark) => {
      setSelected(new Set([mark.pnu]));
      setFlyTo(null);
      flash(`논현동 ${mark.jibun} · 추정 소유자 ${mark.owners}명 — ${mark.reasons[0]}`);
    },
    [flash],
  );

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

  /** 지번 하나의 참여의향서 정보를 저장한다. 성공하면 true */
  const saveConsent = useCallback(
    async (input: ConsentInput & { pnu: string; jibun: string }) => {
      setBusy(true);
      try {
        const res = await fetch("/api/consent", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "저장에 실패했습니다");
        const saved = data as ConsentInfo;
        // 같은 건물로 묶인 딸림 지번 키까지 다시 걸어 지도 색이 바로 따라오게 한다
        setConsent((prev) => applyConsent(prev, saved));
        flash(`논현동 ${saved.jibun} 참여의향서 ${saved.submitted}/${saved.total}호를 저장했습니다.`);
        return true;
      } catch (e) {
        flash(`⚠️ ${(e as Error).message}`);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [flash],
  );

  /** 명부에서 지번을 뺀다 (제출 0호로 되돌린다) */
  const removeConsent = useCallback(
    async (pnu: string) => {
      setBusy(true);
      try {
        const res = await fetch(`/api/consent?pnu=${encodeURIComponent(pnu)}`, {
          method: "DELETE",
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "삭제에 실패했습니다");
        setConsent((prev) => dropConsent(prev, pnu));
        flash("명부에서 뺐습니다.");
        return true;
      } catch (e) {
        flash(`⚠️ ${(e as Error).message}`);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [flash],
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
    <div className="app-viewport flex flex-col overflow-hidden">
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
            onClick={() => toggleOverlay("blocks")}
            aria-pressed={showBlocks}
            title="도로로 나뉜 블록마다 면적 동의율·소유자 동의율·동의자 수를 지도에 표시합니다"
            className={`rounded-lg px-3 py-1.5 text-xs transition ${
              showBlocks
                ? "bg-emerald-600 text-white"
                : "border border-slate-700 text-slate-400 hover:text-slate-200"
            }`}
          >
            블록별
          </button>

          <button
            onClick={() => toggleOverlay("owners")}
            aria-pressed={showOwners}
            title="구역 지번마다 추정 소유자 수를 지도에 표시합니다. 숫자를 누르면 판별 원인이 나옵니다"
            className={`rounded-lg px-3 py-1.5 text-xs transition ${
              showOwners
                ? "bg-blue-600 text-white"
                : "border border-slate-700 text-slate-400 hover:text-slate-200"
            }`}
          >
            소유자
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
              blocks={blockRatios}
              blockRows={blockRows}
              owners={ownerMarks}
              showCadastral={showCadastral}
              flyTo={flyTo}
              onParcelClick={handleParcelClick}
              onBlockClick={handleBlockClick}
              onOwnerClick={handleOwnerClick}
              onLassoSelect={handleLassoSelect}
              onLassoModeChange={setDrawing}
              onNotice={flash}
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
              blocks={blockRatios}
              blockRows={blockRows}
              owners={ownerMarks}
              basemap={basemap}
              flyTo={flyTo}
              onParcelClick={handleParcelClick}
              onBlockClick={handleBlockClick}
              onOwnerClick={handleOwnerClick}
            />
          )}


          {/* 좁은 화면용 요약 열. 왼쪽 위는 확대·축소와 마법 선택 버튼이 쓰므로 오른쪽 위에 둔다.
              오른쪽 패널이 뜨는 넓은 화면에서는 같은 내용이 겹치므로 숨긴다 */}
          <div
            className={`pointer-events-none absolute right-3 top-3 z-[1000] flex max-w-[62vw] flex-col gap-1.5 md:hidden ${
              drawing ? "hidden" : ""
            }`}
          >
            {ownerMarks && <OwnerLegend marks={ownerMarks} compact />}
            {showBlocks && <BlockLegend rows={blockRows} onToggle={toggleBlockRow} compact />}
            <ConsentSummary
              zones={zones}
              consent={consent}
              visibleZoneIds={visibleZoneIds}
              propsOf={propsOf}
              adminMode={adminMode}
              busy={busy}
              compact
              onSetOwners={setZoneOwners}
            />
            <SelectionSummary
              selected={selected}
              propsOf={propsOf}
              consent={consent}
              owners={selectionOwners}
              onOwnersChange={setSelectionOwners}
              compact
            />
          </div>

          {/* 영역을 찍는 동안은 비운다 — 아래 가운데는 영역 조작줄 자리다 */}
          <div
            className={`pointer-events-none absolute bottom-6 left-1/2 z-[1000] flex -translate-x-1/2 flex-col items-center gap-2 text-center ${
              drawing ? "hidden" : ""
            }`}
          >
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

            {/*
              필지를 고르면 구역 전체 카드를 선택 영역 카드로 바꾼다.
              280px 한 줄에 둘 다 쌓으면 아래 지번 검색·필지 목록이 밀려난다.
              고른 게 있는 동안 궁금한 건 그 범위의 숫자지 구역 전체가 아니다.
            */}
            {/* 소유자·블록 표시의 범례. 지도 오른쪽 아래는 이 열이 덮으므로 열 맨 위에 둔다 */}
            {ownerMarks && <OwnerLegend marks={ownerMarks} />}
            {showBlocks && <BlockLegend rows={blockRows} onToggle={toggleBlockRow} />}

            {selected.size === 0 && (
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

            <SelectionSummary
              selected={selected}
              propsOf={propsOf}
              consent={consent}
              owners={selectionOwners}
              onOwnersChange={setSelectionOwners}
            />

            <ParcelPanel
              parcels={parcels}
              consent={consent}
              zoneOf={zoneOf}
              propsOf={propsOf}
              selected={selected}
              setSelected={setSelected}
              onFocusParcel={focusParcel}
              adminMode={adminMode}
              busy={busy}
              onSaveConsent={saveConsent}
              onRemoveConsent={removeConsent}
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
