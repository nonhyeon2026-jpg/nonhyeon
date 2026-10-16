"use client";

import { ownerBasisOf } from "@/lib/consent";
import type { ConsentMap } from "@/lib/consent";
import type { ParcelProps } from "@/lib/types";
import { OWNER_TONE_LEGEND } from "./ownerBadge";

/**
 * 지번 하나의 추정 소유자 수와 판별 원인.
 * 지도의 소유자 표시를 누르면 그 필지가 골라져 여기서 자세한 이유를 읽는다.
 */
export default function OwnerReason({
  pnu,
  propsOf,
  consent,
}: {
  pnu: string;
  propsOf: Map<string, ParcelProps>;
  consent: ConsentMap;
}) {
  const basis = ownerBasisOf(pnu, propsOf, consent);
  if (!basis) return null;
  const color = OWNER_TONE_LEGEND.find((l) => l.tone === basis.tone)?.color ?? "#475569";
  const [head, ...rest] = basis.reasons;

  return (
    <div className="mt-1 rounded bg-slate-900/80 px-1.5 py-1 text-[11px] leading-snug">
      <div className="flex items-center gap-1.5">
        <span className="text-slate-400">추정 소유자</span>
        <span
          className="rounded-full px-1.5 text-[11px] font-semibold text-white"
          style={{ background: color }}
        >
          {basis.owners}명
        </span>
      </div>
      <div className="mt-0.5 text-slate-200">{head}</div>
      {rest.map((r) => (
        <div key={r} className="mt-0.5 text-slate-500">
          {r}
        </div>
      ))}
    </div>
  );
}
