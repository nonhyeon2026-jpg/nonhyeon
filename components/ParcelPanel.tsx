"use client";

import { useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { consentColor, summarize } from "@/lib/consent";
import type { ConsentMap } from "@/lib/consent";
import type { ParcelCollection, ParcelProps, Zone } from "@/lib/types";

/** YYYYMMDD → YYYY.MM.DD */
const formatDate = (d: string) => `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6, 8)}`;

/** 사용승인일로부터 경과 연수 */
const buildingAge = (d: string) => new Date().getFullYear() - Number(d.slice(0, 4));

/** 선택한 필지의 참여의향서 제출 현황 */
function ConsentCard({ pnu, consent }: { pnu: string; consent: ConsentMap }) {
  const c = consent[pnu];
  if (!c) {
    return (
      <div className="mt-1 text-[11px] text-slate-600">참여의향서 제출 없음</div>
    );
  }
  const ratio = Math.round((c.submitted / c.total) * 100);
  return (
    <div className="mt-1 rounded border border-slate-800 bg-slate-900/80 px-1.5 py-1 text-[11px]">
      <div className="flex items-center gap-1.5">
        <span className="text-slate-300">참여의향서</span>
        <span className="font-semibold" style={{ color: consentColor(ratio) }}>
          {c.submitted}/{c.total}호
        </span>
        <span className="ml-auto text-slate-500">{ratio}%</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-800">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.min(100, ratio)}%`, background: consentColor(ratio) }}
        />
      </div>
      {c.units.length > 0 ? (
        <div className="mt-1 flex flex-wrap gap-1">
          {c.units.map((u, i) => (
            <span
              key={`${u}-${i}`}
              className="rounded bg-emerald-500/15 px-1 py-0.5 text-[10px] text-emerald-300"
            >
              {u}
            </span>
          ))}
        </div>
      ) : (
        <div className="mt-1 text-[10px] text-slate-500">
          {c.wholeBuilding ? "통건물 소유자 제출 (전 호 동의)" : "호 구분 없음"}
        </div>
      )}
      {c.wholeBuilding && c.units.length > 0 && (
        <div className="mt-1 text-[10px] text-slate-500">통건물 소유자 제출 (전 호 동의)</div>
      )}
      {c.totalEstimated && (
        <div className="mt-1 text-[10px] text-slate-600">
          건축물대장에 호수가 없어 제출 호수를 총 호수로 봤습니다
        </div>
      )}
      {c.label !== `논현동 ${c.jibun}` && (
        <div className="mt-0.5 text-[10px] text-slate-600">명부 표기: {c.label}</div>
      )}
    </div>
  );
}

/**
 * 지번 검색과 선택한 필지 정보를 담은 지도 위 패널.
 * 지도를 보면서 바로 찾고 확인하는 흐름이라 사이드바가 아니라 지도 오른쪽에 띄운다.
 */
export default function ParcelPanel({
  parcels,
  consent,
  zoneOf,
  propsOf,
  selected,
  setSelected,
  onFocusParcel,
}: {
  parcels: ParcelCollection;
  consent: ConsentMap;
  zoneOf: Map<string, Zone>;
  propsOf: Map<string, ParcelProps>;
  selected: Set<string>;
  setSelected: Dispatch<SetStateAction<Set<string>>>;
  onFocusParcel: (props: ParcelProps, additive?: boolean) => void;
}) {
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const q = query.trim();
    if (!q) return [];
    return parcels.features
      .filter((f) => f.properties.jibun.startsWith(q))
      .slice(0, 40)
      .map((f) => f.properties);
  }, [query, parcels]);

  const selectedList = useMemo(
    () => [...selected].map((p) => propsOf.get(p)).filter(Boolean) as ParcelProps[],
    [selected, propsOf],
  );

  const selectedConsent = useMemo(() => summarize(selected, consent), [selected, consent]);

  const selectedArea = selectedList.reduce((s, p) => s + p.area, 0);
  /** 개별공시지가 × 면적 합계 (공시지가가 있는 필지만) */
  const selectedValue = selectedList.reduce((s, p) => s + (p.jiga ?? 0) * p.area, 0);

  return (
    <div className="thin-scroll pointer-events-auto min-h-0 space-y-4 overflow-y-auto rounded-xl border border-slate-700/70 bg-slate-900/90 p-3 shadow-lg backdrop-blur">
    {/* 지번 검색 */}
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
        지번 검색
      </h2>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="예: 155 또는 155-14"
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none placeholder:text-slate-600 focus:border-emerald-500"
      />
      {results.length > 0 && (
        <ul className="mt-2 space-y-1">
          {results.map((p) => {
            const z = zoneOf.get(p.pnu);
            return (
              <li key={p.pnu}>
                <button
                  onClick={(e) => onFocusParcel(p, e.shiftKey)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-slate-800"
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{ background: z?.color ?? "#475569" }}
                  />
                  <span className="font-medium text-slate-200">논현동 {p.jibun}</span>
                  <span className="ml-auto truncate text-slate-500">
                    {z ? z.name : "미지정"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {query.trim() && results.length === 0 && (
        <p className="mt-2 text-xs text-slate-500">일치하는 지번이 없습니다.</p>
      )}
    </section>

    {/* 선택 필지 */}
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          선택한 필지 {selected.size > 0 && `(${selected.size})`}
        </h2>
        {selected.size > 0 && (
          <button
            onClick={() => setSelected(new Set())}
            className="text-xs text-slate-400 hover:text-slate-200"
          >
            선택 해제
          </button>
        )}
      </div>

      {selected.size === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-800 px-3 py-4 text-center text-xs leading-relaxed text-slate-500">
          지도에서 필지를 클릭하면
          <br />
          지번 정보가 여기에 표시됩니다.
        </p>
      ) : (
        <>
          <div className="mb-2 text-[11px] text-slate-400">
            합계 {selectedArea.toLocaleString()}㎡
            {selectedValue > 0 && (
              <> · 공시지가 총액 약 {Math.round(selectedValue / 1e8).toLocaleString()}억원</>
            )}
            {selectedConsent.parcels > 0 && (
              <>
                <br />
                참여의향서{" "}
                <span style={{ color: consentColor(selectedConsent.ratio) }}>
                  {selectedConsent.submitted}/{selectedConsent.total}호 ({selectedConsent.ratio}%)
                </span>
              </>
            )}
          </div>
          <ul className="space-y-1">
            {selectedList.map((p) => {
              const z = zoneOf.get(p.pnu);
              return (
                <li
                  key={p.pnu}
                  className="rounded-lg border border-slate-800 bg-slate-950/60 px-2.5 py-2 text-xs"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-100">논현동 {p.jibun}</span>
                    <span
                      className="ml-auto rounded px-1.5 py-0.5 text-[10px]"
                      style={{
                        background: (z?.color ?? "#475569") + "33",
                        color: z?.color ?? "#94a3b8",
                      }}
                    >
                      {z ? z.name : "미지정"}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500">
                    {p.category} · {p.area.toLocaleString()}㎡
                    {p.jiga ? ` · 공시지가 ${p.jiga.toLocaleString()}원/㎡` : ""}
                  </div>
                  {p.building ? (
                    <div className="mt-1 rounded bg-slate-900/80 px-1.5 py-1 text-[11px] text-slate-400">
                      <span className="text-slate-200">
                        {p.building.housingType ?? p.building.usage ?? "용도 미상"}
                      </span>
                      {p.building.housingType && p.building.usage !== p.building.housingType && (
                        <span className="text-slate-500"> ({p.building.usage})</span>
                      )}
                      {p.building.name && ` · ${p.building.name}`}
                      {p.building.count > 1 && ` · ${p.building.count}동`}
                      {(p.building.households || p.building.families || p.building.hoCnt) && (
                        <>
                          <br />
                          <span className="text-emerald-400">
                            {[
                              p.building.households ? `${p.building.households}세대` : null,
                              p.building.families ? `${p.building.families}가구` : null,
                              p.building.hoCnt ? `${p.building.hoCnt}호` : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </>
                      )}
                      <br />
                      지상 {p.building.floors}층
                      {p.building.basement > 0 && ` / 지하 ${p.building.basement}층`}
                      {p.building.totalArea > 0 &&
                        ` · 연면적 ${p.building.totalArea.toLocaleString()}㎡`}
                      {p.building.approvedAt && (
                        <>
                          <br />
                          사용승인 {formatDate(p.building.approvedAt)}
                          <span className={buildingAge(p.building.approvedAt) >= 30 ? "text-amber-400" : ""}>
                            {" "}
                            ({buildingAge(p.building.approvedAt)}년)
                          </span>
                        </>
                      )}
                      {p.building.shared && (
                        <>
                          <br />
                          <span className="text-slate-600">여러 필지에 걸친 건물</span>
                        </>
                      )}
                    </div>
                  ) : (
                    <div className="mt-1 text-[11px] text-slate-600">건물 정보 없음</div>
                  )}
                  <ConsentCard pnu={p.pnu} consent={consent} />
                  <div className="mt-1 text-[10px] text-slate-600">PNU {p.pnu}</div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
    </div>
  );
}
