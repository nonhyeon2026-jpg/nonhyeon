"use client";

import type { Zone } from "@/lib/types";

/**
 * 관리자 모드에서 필지를 고르면 지도 위에 뜨는 편집 버튼.
 *
 * 고른 필지가 구역에 없으면 녹색 편입 버튼, 이미 편입돼 있으면 빨간 제외 버튼을 낸다.
 * 둘이 섞여 있으면 둘 다 내고 각각 몇 필지가 대상인지 함께 보여준다.
 */
export default function ParcelActions({
  selected,
  zoneOf,
  busy,
  onAdd,
  onRemove,
}: {
  selected: Set<string>;
  zoneOf: Map<string, Zone>;
  busy: boolean;
  onAdd: () => void;
  onRemove: () => void;
}) {
  if (!selected.size) return null;

  let zoned = 0;
  for (const pnu of selected) if (zoneOf.has(pnu)) zoned += 1;
  const unzoned = selected.size - zoned;

  return (
    <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/95 px-2 py-2 shadow-xl backdrop-blur">
      <span className="pl-2 pr-1 text-xs text-slate-400">{selected.size}필지 선택</span>

      {unzoned > 0 && (
        <button
          disabled={busy}
          onClick={onAdd}
          className="rounded-full bg-emerald-500 px-4 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          구역에 편입
          {zoned > 0 && ` (${unzoned})`}
        </button>
      )}

      {zoned > 0 && (
        <button
          disabled={busy}
          onClick={onRemove}
          className="rounded-full bg-red-500 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          구역에서 제외
          {unzoned > 0 && ` (${zoned})`}
        </button>
      )}
    </div>
  );
}
