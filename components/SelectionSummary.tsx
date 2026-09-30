"use client";

import { useMemo } from "react";
import { consentColor, summarizeZone } from "@/lib/consent";
import type { ConsentMap } from "@/lib/consent";
import type { ParcelProps } from "@/lib/types";

/**
 * 고른 필지 묶음만으로 따로 낸 동의율.
 *
 * 구역계를 긋기 전에 "이 블록만 묶으면 몇 %인가" 를 바로 보려는 것이라
 * 구역 소속과 무관하게 선택된 필지만 센다. 계산은 구역 요약과 같은
 * summarizeZone 을 쓰므로 같은 범위를 고르면 구역 카드와 숫자가 맞는다.
 *
 * 소유자 수는 구역처럼 저장된 값이 없다. 기본은 건축물대장 호수 합계로 두고,
 * 현장에서 아는 숫자를 넣어 바꿔볼 수 있게 한다 (저장하지 않는다).
 *
 * 넓은 화면에서는 이 카드가 뜨는 동안 구역 전체 카드를 치운다 (AppShell) —
 * 280px 한 줄에 둘 다 쌓으면 아래 지번 검색·필지 목록이 밀려난다.
 */
export default function SelectionSummary({
  selected,
  propsOf,
  consent,
  owners,
  onOwnersChange,
  compact = false,
}: {
  selected: Set<string>;
  propsOf: Map<string, ParcelProps>;
  consent: ConsentMap;
  /** 제출률의 분모로 쓸 소유자 수. 비어 있으면 호수 합계를 쓴다 */
  owners: string;
  onOwnersChange: (v: string) => void;
  /** 좁은 화면용 — 두 비율만 한 줄로 */
  compact?: boolean;
}) {
  const pnus = useMemo(() => [...selected], [selected]);
  const parsed = Math.round(Number(owners));
  const usable = owners.trim() && Number.isFinite(parsed) && parsed >= 1 ? parsed : null;
  const s = useMemo(
    () => summarizeZone(pnus, propsOf, consent, usable),
    [pnus, propsOf, consent, usable],
  );

  // 선택이 없거나 필지 데이터가 아직 안 왔으면 그리지 않는다
  if (!s.zoneParcels) return null;

  const color = consentColor(s.ownerRatio);
  const areaColor = consentColor(s.areaRatio);

  if (compact) {
    return (
      <div className="pointer-events-auto rounded-lg border border-emerald-500/50 bg-slate-900/90 px-2.5 py-1.5 text-left shadow-lg backdrop-blur">
        <div className="truncate text-[10px] font-medium text-emerald-300">
          선택 {s.zoneParcels.toLocaleString()}필지
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <Ratio value={s.ownerRatio} label="제출" />
          <span className="h-2.5 w-px shrink-0 self-center bg-slate-700" />
          <Ratio value={s.areaRatio} label="면적" />
        </div>
      </div>
    );
  }

  return (
    <div className="pointer-events-auto shrink-0 rounded-xl border border-emerald-500/50 bg-slate-900/90 px-3.5 py-3 shadow-lg backdrop-blur">
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-sm bg-emerald-500" />
        <span className="truncate text-xs font-medium text-slate-200">
          선택 영역 {s.zoneParcels.toLocaleString()}필지
        </span>
      </div>

      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold leading-none" style={{ color }}>
          {s.ownerRatio}%
        </span>
        <span className="text-[11px] text-slate-400">참여의향서 제출률</span>
      </div>

      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${Math.min(100, s.ownerRatio)}%`, background: color }}
        />
      </div>

      <div className="mt-2 text-[11px] text-slate-300">
        총 {(s.owners ?? s.total).toLocaleString()}
        {s.owners ? "명" : "호"} 중{" "}
        <span className="font-semibold" style={{ color }}>
          {s.submitted.toLocaleString()}호
        </span>{" "}
        제출
      </div>
      <div className="mt-0.5 text-[11px] text-slate-500">
        {s.submittedParcels.toLocaleString()}개 필지에서 제출
        {s.owners !== null && <> · 호수 합계 {s.total.toLocaleString()}호 기준 {s.ratio}%</>}
      </div>

      <div className="mt-2.5 border-t border-slate-800 pt-2">
        <div className="flex items-baseline gap-1.5">
          <span className="text-lg font-semibold leading-none" style={{ color: areaColor }}>
            {s.areaRatio}%
          </span>
          <span className="text-[11px] text-slate-400">면적 동의율</span>
        </div>

        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-800">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${Math.min(100, s.areaRatio)}%`, background: areaColor }}
          />
        </div>

        <div className="mt-1.5 text-[11px] text-slate-300">
          {Math.round(s.area).toLocaleString()}㎡ 중{" "}
          <span className="font-semibold" style={{ color: areaColor }}>
            {Math.round(s.consentedArea).toLocaleString()}㎡
          </span>{" "}
          동의
        </div>
      </div>

      <div className="mt-2.5 border-t border-slate-800 pt-2.5">
        <label className="block text-[10px] text-slate-400">
          소유자 수 (비우면 호수 합계 {s.total.toLocaleString()}호)
        </label>
        <input
          type="number"
          min={1}
          value={owners}
          placeholder={String(s.total)}
          onChange={(e) => onOwnersChange(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs outline-none focus:border-emerald-500"
        />
        <p className="mt-1 text-[10px] leading-snug text-slate-600">
          선택이 바뀌면 지워집니다. 저장되지 않습니다.
          <br />
          선택을 해제하면 구역 전체 현황이 다시 보입니다.
        </p>
      </div>
    </div>
  );
}

function Ratio({ value, label }: { value: number; label: string }) {
  return (
    <span className="flex items-baseline gap-1 whitespace-nowrap">
      <span className="text-sm font-semibold leading-none" style={{ color: consentColor(value) }}>
        {value}%
      </span>
      <span className="text-[10px] text-slate-500">{label}</span>
    </span>
  );
}
