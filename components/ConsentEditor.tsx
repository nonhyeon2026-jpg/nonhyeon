"use client";

import { useState } from "react";
import { consentColor, parcelUnits } from "@/lib/consent";
import type { ConsentInfo, ConsentInput, ParcelProps } from "@/lib/types";

/** 호 목록 입력은 쉼표·공백·줄바꿈 아무거나로 나눈다 — 명부를 그대로 붙여넣는 일이 많다 */
const parseUnits = (text: string) =>
  text
    .split(/[,\s]+/)
    .map((u) => u.trim())
    .filter((u) => u && u !== "-");

const label = "block text-[10px] uppercase tracking-wider text-slate-500";
const field =
  "w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100 outline-none focus:border-emerald-500";

/**
 * 관리자가 지번 하나의 참여의향서 제출 현황을 고치는 폼.
 * 선택한 필지 카드 안에 펼쳐지므로 지도를 보면서 바로 입력할 수 있다.
 */
export default function ConsentEditor({
  parcel,
  consent,
  busy,
  onSave,
  onDelete,
  onClose,
  pnuOfJibun,
  jibunOfPnu,
}: {
  parcel: ParcelProps;
  /** 이미 명부에 있으면 그 값, 새로 넣는 것이면 undefined */
  consent: ConsentInfo | undefined;
  busy: boolean;
  /** 지번("176-3") ↔ PNU 변환. 지적도에 없는 지번은 null */
  pnuOfJibun: (jibun: string) => string | null;
  jibunOfPnu: (pnu: string) => string | null;
  onSave: (input: ConsentInput & { pnu: string; jibun: string }) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
  onClose: () => void;
}) {
  // 새로 넣는 필지의 총 호수는 건축물대장에서 뽑은 값으로 채워둔다
  const [total, setTotal] = useState(String(consent?.total ?? parcelUnits(parcel)));
  const [submitted, setSubmitted] = useState(String(consent?.submitted ?? 0));
  const [unitText, setUnitText] = useState((consent?.units ?? []).join(", "));
  const [wholeBuilding, setWholeBuilding] = useState(consent?.wholeBuilding ?? false);
  const [labelText, setLabelText] = useState(consent?.label ?? "");
  // 한 건물이 걸쳐 있는 다른 지번. PNU 는 길어서 화면에서는 지번으로 주고받는다
  const [sharedText, setSharedText] = useState(() =>
    (consent?.sharedPnus ?? []).map((p) => jibunOfPnu(p) ?? p).join(", "),
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const units = parseUnits(unitText);
  const totalNum = Math.max(1, Math.round(Number(total) || 1));
  // 저장될 값을 미리 그대로 계산해 보여준다 (lib/consentStore.ts 의 규칙과 같다)
  const submittedNum = wholeBuilding
    ? totalNum
    : units.length
      ? Math.min(units.length, totalNum)
      : Math.max(0, Math.min(Math.round(Number(submitted) || 0), totalNum));
  const ratio = Math.round((submittedNum / totalNum) * 100);

  /**
   * "총 호수를 제출 호수로 갈음" 은 명부를 들여올 때 대장에서 호수를 못 구했다는
   * 자동 표시이지 입력 항목이 아니다. 사람이 총 호수를 직접 고치면 확인된 값이므로
   * 꼬리표를 떼고, 손대지 않았으면 원래 표시를 그대로 물려준다.
   */
  const totalEstimated = consent?.totalEstimated ? totalNum === consent.total : false;

  const sharedJibuns = parseUnits(sharedText);
  const unknownJibuns = sharedJibuns.filter((j) => !pnuOfJibun(j));

  const save = async () => {
    if (unknownJibuns.length) {
      setError(`지적도에 없는 지번입니다: ${unknownJibuns.join(", ")}`);
      return;
    }
    setError(null);
    const ok = await onSave({
      pnu: parcel.pnu,
      jibun: parcel.jibun,
      label: labelText,
      total: totalNum,
      submitted: submittedNum,
      units,
      wholeBuilding,
      totalEstimated,
      sharedPnus: sharedJibuns.map((j) => pnuOfJibun(j) as string),
    });
    if (ok) onClose();
  };

  return (
    <div className="mt-1 rounded border border-emerald-600/50 bg-slate-950/80 px-2 py-2 text-[11px]">
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="font-semibold text-emerald-300">참여의향서 입력</span>
        <span className="ml-auto font-semibold" style={{ color: consentColor(ratio) }}>
          {submittedNum}/{totalNum}호 ({ratio}%)
        </span>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <div>
          <span className={label}>총 호수</span>
          <input
            type="number"
            min={1}
            value={total}
            onChange={(e) => setTotal(e.target.value)}
            className={field}
          />
        </div>
        <div>
          <span className={label}>제출 호수</span>
          <input
            type="number"
            min={0}
            value={wholeBuilding || units.length ? submittedNum : submitted}
            onChange={(e) => setSubmitted(e.target.value)}
            disabled={wholeBuilding || units.length > 0}
            className={`${field} disabled:text-slate-500`}
          />
        </div>
      </div>

      <div className="mt-1.5">
        <span className={label}>제출 호 목록</span>
        <input
          value={unitText}
          onChange={(e) => setUnitText(e.target.value)}
          placeholder="예: 101, 102, B01 (비워두면 호 구분 없음)"
          className={field}
        />
        {units.length > 0 && (
          <p className="mt-0.5 text-[10px] text-slate-500">
            {units.length}개 호 — 제출 호수는 이 목록에서 셉니다
          </p>
        )}
      </div>

      <div className="mt-1.5">
        <span className={label}>다른 지번과 묶기</span>
        <input
          value={sharedText}
          onChange={(e) => {
            setSharedText(e.target.value);
            setError(null);
          }}
          placeholder="예: 176-3 (한 건물이 걸쳐 있는 지번)"
          className={field}
        />
        <p className="mt-0.5 text-[10px] text-slate-500">
          적어 둔 지번은 이 명부를 그대로 쓰고, 총 호수는 한 번만 셉니다.
        </p>
      </div>

      <div className="mt-1.5">
        <span className={label}>명부 표기</span>
        <input
          value={labelText}
          onChange={(e) => setLabelText(e.target.value)}
          placeholder={`논현동 ${parcel.jibun}`}
          className={field}
        />
      </div>

      <label className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-300">
        <input
          type="checkbox"
          checked={wholeBuilding}
          onChange={(e) => setWholeBuilding(e.target.checked)}
          className="accent-emerald-500"
        />
        통건물 소유자 제출 (전 호 동의)
      </label>
      {totalEstimated && (
        <p className="mt-1 text-[10px] text-slate-500">
          총 호수가 건축물대장이 아니라 제출 호수로 갈음돼 있습니다. 실제 호수를 알면 위에서
          고쳐 주세요.
        </p>
      )}

      {error && <p className="mt-1.5 text-[11px] text-red-400">{error}</p>}

      <div className="mt-2 flex items-center gap-1.5">
        <button
          onClick={save}
          disabled={busy}
          className="rounded bg-emerald-600 px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
        >
          저장
        </button>
        <button
          onClick={onClose}
          className="rounded border border-slate-700 px-2.5 py-1 text-[11px] text-slate-300 transition hover:bg-slate-800"
        >
          취소
        </button>
        {consent &&
          (confirmDelete ? (
            <button
              onClick={async () => {
                if (await onDelete()) onClose();
              }}
              disabled={busy}
              className="ml-auto rounded bg-red-600 px-2.5 py-1 text-[11px] text-white transition hover:bg-red-500 disabled:opacity-50"
            >
              정말 삭제
            </button>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="ml-auto text-[11px] text-slate-500 transition hover:text-red-400"
            >
              명부에서 빼기
            </button>
          ))}
      </div>
    </div>
  );
}
