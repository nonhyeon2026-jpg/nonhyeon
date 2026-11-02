"use client";

import { BLOCK_BADGE_ROWS, LOW_BLOCK_FILL_OPACITY, LOW_BLOCK_STROKE, LOW_OWNER_RATIO } from "./blockBadge";
import type { BlockRowKey } from "./blockBadge";

/**
 * 블록별 표시를 켰을 때 뜨는 범례 겸 단추. 지도 표시의 줄 색과 같은 색 단추로
 * 어느 줄이 무엇인지 알려 주고, 눌러서 그 줄을 켜고 끈다.
 */
export default function BlockLegend({
  rows,
  onToggle,
  compact = false,
}: {
  rows: BlockRowKey[];
  onToggle: (k: BlockRowKey) => void;
  /** 좁은 화면용 — 단추만 한 줄로 */
  compact?: boolean;
}) {
  const buttons = BLOCK_BADGE_ROWS.map((r) => {
    const on = rows.includes(r.key);
    return (
      <button
        key={r.key}
        onClick={() => onToggle(r.key)}
        aria-pressed={on}
        title={on ? `${r.label} 숨기기` : `${r.label} 보이기`}
        className={`whitespace-nowrap rounded-md border px-2 py-1 text-[11px] font-medium transition ${
          on ? "border-white/70 text-white" : "border-slate-700 bg-slate-900 text-slate-500 hover:text-slate-300"
        }`}
        style={on ? { background: r.color } : undefined}
      >
        {r.button}
      </button>
    );
  });

  if (compact) {
    return (
      <div className="pointer-events-auto flex flex-wrap justify-end gap-1 rounded-lg border border-emerald-500/50 bg-slate-900/90 p-1.5 shadow-lg backdrop-blur">
        {buttons}
      </div>
    );
  }

  return (
    <div className="pointer-events-auto shrink-0 rounded-xl border border-emerald-500/50 bg-slate-900/90 px-3.5 py-3 shadow-lg backdrop-blur">
      <div className="text-[11px] text-slate-400">블록 표시 — 눌러서 줄을 켜고 끕니다</div>
      <div className="mt-2 flex flex-wrap gap-1.5">{buttons}</div>
      <p className="mt-1.5 text-[10px] leading-snug text-slate-500">
        상자가 수치만큼 차오릅니다. 꽉 차면 기준 도달 —{" "}
        {BLOCK_BADGE_ROWS.map((r) => `${r.label} ${r.fullText}`).join(" · ")}
      </p>
      <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-slate-400">
        <span
          className="h-2.5 w-4 shrink-0 rounded-sm border-[3px] ring-1 ring-slate-400"
          style={{ borderColor: LOW_BLOCK_STROKE, background: `rgba(0,0,0,${LOW_BLOCK_FILL_OPACITY})` }}
        />
        소유자 동의율 {LOW_OWNER_RATIO}% 미만 블록
      </div>
    </div>
  );
}
