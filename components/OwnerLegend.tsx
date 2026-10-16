"use client";

import { OWNER_TONE_LEGEND } from "./ownerBadge";
import type { OwnerMark } from "./ownerBadge";

/**
 * 소유자 표시를 켰을 때 뜨는 범례 카드. 지도 숫자의 색이 무엇인지와
 * 보이는 구역의 추정 소유자 합계를 보여준다. 합계는 지도 숫자를 그대로 더한 값이라
 * 구역 카드의 추정 소유자와 같다.
 */
export default function OwnerLegend({
  marks,
  compact = false,
}: {
  marks: OwnerMark[];
  /** 좁은 화면용 — 합계와 색만 한 덩어리로 */
  compact?: boolean;
}) {
  const total = marks.reduce((a, m) => a + m.owners, 0);
  const byTone = new Map<string, { parcels: number; owners: number }>();
  for (const m of marks) {
    const t = byTone.get(m.tone) ?? { parcels: 0, owners: 0 };
    t.parcels += 1;
    t.owners += m.owners;
    byTone.set(m.tone, t);
  }

  if (compact) {
    return (
      <div className="pointer-events-auto rounded-lg border border-blue-500/50 bg-slate-900/90 px-2.5 py-1.5 text-left shadow-lg backdrop-blur">
        <div className="text-[10px] text-slate-400">
          추정 소유자{" "}
          <span className="text-sm font-semibold text-blue-300">{total.toLocaleString()}명</span>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-slate-400">
          {OWNER_TONE_LEGEND.map((l) => (
            <span key={l.tone} className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ background: l.color }} />
              {l.label}
            </span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="pointer-events-auto shrink-0 rounded-xl border border-blue-500/50 bg-slate-900/90 px-3.5 py-3 shadow-lg backdrop-blur">
      <div className="flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold leading-none text-blue-300">
          {total.toLocaleString()}명
        </span>
        <span className="text-[11px] text-slate-400">추정 소유자</span>
      </div>
      <div className="mt-1 text-[11px] text-slate-500">
        보이는 구역 {marks.length.toLocaleString()}필지 · 숫자를 누르면 판별 원인이 나옵니다
      </div>

      <table className="mt-2 w-full text-[11px]">
        <tbody>
          {OWNER_TONE_LEGEND.map((l) => {
            const t = byTone.get(l.tone);
            return (
              <tr key={l.tone} className={t ? "text-slate-300" : "text-slate-600"}>
                <td className="py-0.5">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: l.color }} />
                    {l.label}
                  </span>
                </td>
                <td className="py-0.5 text-right text-slate-500">{t?.parcels ?? 0}필지</td>
                <td className="py-0.5 text-right font-medium">{(t?.owners ?? 0).toLocaleString()}명</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-1.5 text-[10px] leading-snug text-slate-600">{OWNER_TONE_HINT}</p>
    </div>
  );
}

const OWNER_TONE_HINT =
  "통건물: 한 사람이 건물 전체 · 일부 묶음: 한 사람이 여러 호 · 확인 필요: 공동건축주 의심 · " +
  "여러 동: 한 땅의 동마다 주인 · 호마다: 1호 1명 · 1명: 일반건축물·땅(공동명의 포함) · " +
  "다른 지번에서 셈: 딸림 지번·같은 건물(0명). " +
  "확대 17 이상에서 숫자가 보입니다.";
