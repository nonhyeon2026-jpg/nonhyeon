"use client";

import type { OutsideConsent } from "@/lib/consent";
import { submitters } from "@/lib/consent";
import type { ParcelProps } from "@/lib/types";
import { OUTSIDE_STROKE } from "./outsideStyle";

/**
 * "구역 밖" 표시를 켰을 때 뜨는 목록 카드. 어느 구역에도 들지 않은 지번의 제출을 모아
 * 보여 주고, 누르면 그 필지로 간다. 구역 제출률에는 들어가지 않는 숫자다.
 */
export default function OutsideConsentList({
  outside,
  propsOf,
  onFocus,
  compact = false,
}: {
  outside: OutsideConsent;
  propsOf: Map<string, ParcelProps>;
  onFocus: (props: ParcelProps) => void;
  /** 좁은 화면용 — 합계만 */
  compact?: boolean;
}) {
  const { docs, people } = outside;

  if (compact) {
    return (
      <div className="pointer-events-auto rounded-lg border border-violet-500/50 bg-slate-900/90 px-2.5 py-1.5 text-left shadow-lg backdrop-blur">
        <div className="text-[10px] text-slate-400">
          구역 밖 제출{" "}
          <span className="text-sm font-semibold text-violet-300">{people.toLocaleString()}명</span>{" "}
          · {docs.length}필지
        </div>
      </div>
    );
  }

  return (
    <div className="pointer-events-auto flex max-h-[40vh] shrink-0 flex-col rounded-xl border border-violet-500/50 bg-slate-900/90 px-3.5 py-3 shadow-lg backdrop-blur">
      <div className="flex items-center gap-2">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-sm border-2 border-dashed"
          style={{ borderColor: OUTSIDE_STROKE }}
        />
        <span className="text-xs font-medium text-slate-200">구역 밖 제출</span>
        <span className="ml-auto text-xs font-semibold text-violet-300">
          {people.toLocaleString()}명 · {docs.length}필지
        </span>
      </div>
      <p className="mt-1 text-[10px] leading-snug text-slate-500">
        어느 구역에도 들지 않은 지번입니다. 구역 제출률에는 넣지 않습니다.
      </p>

      {docs.length === 0 ? (
        <p className="mt-2 text-[11px] text-slate-500">구역 밖 제출이 없습니다.</p>
      ) : (
        <ul className="mt-2 min-h-0 space-y-0.5 overflow-y-auto">
          {docs.map((c) => {
            const props = propsOf.get(c.pnu);
            return (
              <li key={c.pnu}>
                <button
                  disabled={!props}
                  onClick={() => props && onFocus(props)}
                  className="flex w-full items-baseline gap-2 rounded px-1.5 py-1 text-left text-[11px] transition hover:bg-slate-800 disabled:opacity-50"
                >
                  <span className="text-slate-200">논현동 {c.jibun}</span>
                  <span className="ml-auto text-slate-400">
                    {c.wholeBuilding ? "통건물" : `${c.submitted}/${c.total}호`} ·{" "}
                    {submitters(c, props)}명
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
