"use client";

import { consentColor, summarize } from "@/lib/consent";
import type { ConsentMap } from "@/lib/consent";
import type { ParcelProps, Zone } from "@/lib/types";

/**
 * 모바일에서 필지를 골랐을 때 지도 아래에 뜨는 간략 정보.
 * 오른쪽 패널은 좁은 화면에서 지도를 다 덮어버려 숨기고, 꼭 필요한 것만 여기 담는다.
 */
export default function ParcelBrief({
  selected,
  propsOf,
  zoneOf,
  consent,
  onClear,
}: {
  selected: Set<string>;
  propsOf: Map<string, ParcelProps>;
  zoneOf: Map<string, Zone>;
  consent: ConsentMap;
  onClear: () => void;
}) {
  const list = [...selected].map((p) => propsOf.get(p)).filter(Boolean) as ParcelProps[];
  if (!list.length) return null;

  const s = summarize(selected, consent);
  const only = list.length === 1 ? list[0] : null;
  const c = only ? consent[only.pnu] : undefined;
  const ratio = c ? Math.round((c.submitted / c.total) * 100) : null;

  return (
    <div className="pointer-events-auto w-[min(92vw,360px)] rounded-xl border border-slate-700 bg-slate-900/95 px-3 py-2.5 text-left shadow-xl backdrop-blur">
      <div className="flex items-center gap-2">
        <span className="truncate text-sm font-semibold text-slate-100">
          {only ? `논현동 ${only.jibun}` : `${list.length}필지 선택`}
        </span>
        <span className="ml-auto shrink-0 text-[11px] text-slate-500">
          {only ? (zoneOf.get(only.pnu)?.name ?? "구역 미지정") : `${s.parcels}필지 명부 등록`}
        </span>
        <button
          onClick={onClear}
          aria-label="선택 해제"
          className="shrink-0 rounded px-1.5 text-slate-500 transition hover:text-slate-200"
        >
          ✕
        </button>
      </div>

      <div className="mt-1 text-[11px] text-slate-400">
        {only ? (
          <>
            {only.category} · {only.area.toLocaleString()}㎡
            {only.building?.housingType && ` · ${only.building.housingType}`}
          </>
        ) : (
          <>합계 {list.reduce((sum, p) => sum + p.area, 0).toLocaleString()}㎡</>
        )}
      </div>

      {only ? (
        c ? (
          <div className="mt-1.5 flex items-center gap-2">
            <span className="text-[11px] text-slate-400">참여의향서</span>
            <span className="text-sm font-semibold" style={{ color: consentColor(ratio!) }}>
              {c.submitted}/{c.total}호
            </span>
            <span className="text-[11px] text-slate-500">{ratio}%</span>
            {c.wholeBuilding && (
              <span className="ml-auto text-[10px] text-slate-500">통건물 제출</span>
            )}
          </div>
        ) : (
          <div className="mt-1.5 text-[11px] text-slate-500">참여의향서 제출 없음</div>
        )
      ) : (
        s.total > 0 && (
          <div className="mt-1.5 flex items-center gap-2">
            <span className="text-[11px] text-slate-400">참여의향서</span>
            <span className="text-sm font-semibold" style={{ color: consentColor(s.ratio) }}>
              {s.submitted}/{s.total}호
            </span>
            <span className="text-[11px] text-slate-500">{s.ratio}%</span>
          </div>
        )
      )}
    </div>
  );
}
