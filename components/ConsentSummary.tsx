"use client";

import { useEffect, useState } from "react";
import { CONSENT_GRADIENT, consentColor, residentialColor, summarizeZone } from "@/lib/consent";
import type { ConsentMap } from "@/lib/consent";
import { RESIDENTIAL_CLASSES } from "@/lib/zoning";
import type { ParcelProps, Zone } from "@/lib/types";

/**
 * 구역별 참여의향서 제출 현황 요약.
 * 지도 위에 얹혀서, 필지를 하나씩 눌러보지 않아도 구역 전체 상황이 보이게 한다.
 *
 * 제출률의 분모는 건축물대장 호수 합계가 아니라 구역에 설정된 총 소유자 수다.
 * 한 사람이 여러 호를 가진 경우가 있어 호수 합계는 실제 소유자보다 부풀려진다.
 *
 * 면적 동의율은 호수와 별개로 필지 단위다. 다세대에서 한 호만 냈어도 그 필지 면적은
 * 전부 동의 쪽에 들어간다 — 사업 대상에 필지가 통째로 들어가기 때문이다.
 */
export default function ConsentSummary({
  zones,
  visibleZoneIds,
  propsOf,
  consent,
  adminMode,
  busy,
  compact = false,
  onSetOwners,
}: {
  zones: Zone[];
  visibleZoneIds: Set<string>;
  propsOf: Map<string, ParcelProps>;
  consent: ConsentMap;
  adminMode: boolean;
  busy: boolean;
  /** 좁은 화면용 — 두 비율만 한 줄로 (범례·총 소유자 입력은 넓은 화면에만) */
  compact?: boolean;
  onSetOwners: (zoneId: string, owners: number) => void;
}) {
  const shown = zones.filter((z) => visibleZoneIds.has(z.id));
  if (!shown.length) return null;

  return (
    <div className={compact ? "space-y-1.5" : "shrink-0 space-y-2"}>
      {shown.map((zone) =>
        compact ? (
          <ZonePill key={zone.id} zone={zone} propsOf={propsOf} consent={consent} />
        ) : (
          <ZoneCard
            key={zone.id}
            zone={zone}
            propsOf={propsOf}
            consent={consent}
            adminMode={adminMode}
            busy={busy}
            onSetOwners={onSetOwners}
          />
        ),
      )}
    </div>
  );
}

/**
 * 좁은 화면에서 지도 위에 얹는 작은 요약.
 * 지도를 가리지 않아야 하므로 제출률·면적 동의율 두 숫자만 남긴다.
 */
function ZonePill({
  zone,
  propsOf,
  consent,
}: {
  zone: Zone;
  propsOf: Map<string, ParcelProps>;
  consent: ConsentMap;
}) {
  const s = summarizeZone(zone.parcels, propsOf, consent, zone.owners);
  // 필지 데이터가 아직 안 왔으면 0% 를 띄우는 대신 아무것도 그리지 않는다 (넓은 화면과 같다)
  if (!s.zoneParcels) return null;

  return (
    <div className="pointer-events-auto rounded-lg border border-slate-700/70 bg-slate-900/90 px-2.5 py-1.5 text-left shadow-lg backdrop-blur">
      <div className="flex items-center gap-1.5">
        <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: zone.color }} />
        <span className="truncate text-[10px] font-medium text-slate-400">{zone.name}</span>
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <Ratio value={s.ownerRatio} label="제출" />
        <span className="self-center h-2.5 w-px shrink-0 bg-slate-700" />
        <Ratio value={s.areaRatio} label="면적" />
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

function ZoneCard({
  zone,
  propsOf,
  consent,
  adminMode,
  busy,
  onSetOwners,
}: {
  zone: Zone;
  propsOf: Map<string, ParcelProps>;
  consent: ConsentMap;
  adminMode: boolean;
  busy: boolean;
  onSetOwners: (zoneId: string, owners: number) => void;
}) {
  const s = summarizeZone(zone.parcels, propsOf, consent, zone.owners);
  const [draft, setDraft] = useState(String(zone.owners ?? ""));

  // 다른 곳에서 값이 바뀌면(저장 성공, 구역 교체) 입력칸도 따라간다
  useEffect(() => setDraft(String(zone.owners ?? "")), [zone.owners]);

  // 필지 데이터가 아직 안 왔으면 0/0 을 띄우는 대신 아무것도 그리지 않는다
  if (!s.zoneParcels) return null;

  const color = consentColor(s.ownerRatio);
  const areaColor = consentColor(s.areaRatio);
  const changed = draft.trim() !== String(zone.owners ?? "");
  const parsed = Number(draft);
  const valid = Number.isFinite(parsed) && parsed >= 1;

  const submit = () => {
    if (!valid || !changed) return;
    onSetOwners(zone.id, Math.round(parsed));
  };

  return (
    <div className="pointer-events-auto rounded-xl border border-slate-700/70 bg-slate-900/90 px-3.5 py-3 shadow-lg backdrop-blur">
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: zone.color }} />
        <span className="truncate text-xs font-medium text-slate-200">{zone.name}</span>
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
        필지 {s.zoneParcels.toLocaleString()}개 중 {s.submittedParcels.toLocaleString()}개에서 제출
        {s.owners !== null && (
          <>
            <br />
            건축물대장 호수 합계 {s.total.toLocaleString()}호 기준으로는 {s.ratio}%
          </>
        )}
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
        <div className="mt-0.5 text-[11px] leading-snug text-slate-500">
          한 호라도 제출한 필지는 면적을 전부 동의로 셉니다
        </div>
      </div>

      <div className="mt-2.5 border-t border-slate-800 pt-2">
        <div
          className="h-2.5 w-full rounded-sm"
          style={{ background: CONSENT_GRADIENT, opacity: 0.9 }}
        />
        <div className="mt-1 flex justify-between text-[10px] text-slate-500">
          <span>필지별 제출률 0%</span>
          <span>100%</span>
        </div>
        {/* 제출이 없는 구역 필지는 용도지역별로 색이 조금씩 다르다 */}
        <div className="mt-1.5 flex items-center gap-2.5 whitespace-nowrap text-[10px] text-slate-500">
          <span>제출 없음 · 일반주거</span>
          {RESIDENTIAL_CLASSES.map((cls) => (
            <span key={cls} className="flex items-center gap-1">
              <span
                className="h-2.5 w-2.5 rounded-sm"
                style={{ background: residentialColor(cls), opacity: 0.9 }}
              />
              {cls}종
            </span>
          ))}
        </div>
      </div>

      {adminMode ? (
        <div className="mt-2.5 border-t border-slate-800 pt-2.5">
          <label className="block text-[10px] text-slate-400">총 소유자 수 (제출률 분모)</label>
          <div className="mt-1 flex gap-1.5">
            <input
              type="number"
              min={1}
              value={draft}
              disabled={busy}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs outline-none focus:border-emerald-500 disabled:opacity-40"
            />
            <button
              onClick={submit}
              disabled={busy || !changed || !valid}
              className="shrink-0 rounded-lg bg-emerald-500 px-2.5 py-1 text-xs font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              저장
            </button>
          </div>
          {!valid && draft.trim() !== "" && (
            <p className="mt-1 text-[10px] text-red-300">1 이상의 숫자를 넣어주세요.</p>
          )}
        </div>
      ) : (
        s.owners !== null && (
          <div className="mt-1.5 text-[10px] leading-snug text-slate-600">
            총 소유자 수는 관리자 모드에서 바꿀 수 있습니다.
          </div>
        )
      )}
    </div>
  );
}
