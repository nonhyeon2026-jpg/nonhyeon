"use client";

import { useCallback, useEffect, useState } from "react";
import type { HistoryEntry, ParcelProps } from "@/lib/types";

/**
 * 구역·명부 변경 기록 창 (관리자 모드).
 *
 * 관리자 계정이 하나라 아이디로는 누가 했는지 가릴 수 없어 IP 와 기기를 함께 보여 준다.
 * 구역에서 빠진 필지는 "다시 넣기" 로 한 번에 되돌린다 (그것도 기록에 남는다).
 */

const ACTION: Record<string, string> = {
  add: "구역에 편입",
  remove: "구역에서 제외",
  clear: "구역 비우기",
  setOwners: "총 소유자 수 변경",
  createZone: "구역 만들기",
  deleteZone: "구역 삭제",
  save: "명부 저장",
  delete: "명부에서 빼기",
};

/** 빼는 쪽은 빨강 — 사고가 나는 쪽이 먼저 눈에 들어와야 한다 */
const DANGER = new Set(["remove", "clear", "deleteZone", "delete"]);

/** 지번을 다 보이면 줄이 넘치므로 이만큼만 보이고 나머지는 펼친다 */
const SHOWN = 12;

/** User-Agent 를 사람이 읽을 만큼만 줄인다 */
function device(agent: string): string {
  if (!agent) return "알 수 없음";
  const os = /iPhone|iPad/.test(agent)
    ? "iOS"
    : /Android/.test(agent)
      ? "Android"
      : /Windows/.test(agent)
        ? "Windows"
        : /Mac OS X/.test(agent)
          ? "Mac"
          : "기타";
  const browser = /Edg\//.test(agent)
    ? "Edge"
    : /SamsungBrowser/.test(agent)
      ? "삼성 인터넷"
      : /KAKAOTALK/.test(agent)
        ? "카카오톡"
        : /NAVER/.test(agent)
          ? "네이버"
          : /Chrome\//.test(agent)
            ? "Chrome"
            : /Safari\//.test(agent)
              ? "Safari"
              : /Firefox\//.test(agent)
                ? "Firefox"
                : "브라우저";
  return `${os} · ${browser}`;
}

const when = (iso: string) =>
  new Date(iso).toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

type Brief = { submitted: number; total: number; wholeBuilding?: boolean };
const brief = (v: unknown) => {
  const b = v as Brief | null | undefined;
  return b ? `${b.submitted}/${b.total}호${b.wholeBuilding ? " 통건물" : ""}` : "없음";
};

export default function HistoryPanel({
  propsOf,
  busy,
  onClose,
  onRestore,
}: {
  propsOf: Map<string, ParcelProps>;
  busy: boolean;
  onClose: () => void;
  /** 빠진 필지를 그 구역에 다시 넣는다. 성공하면 true */
  onRestore: (zoneId: string, pnus: string[]) => Promise<boolean>;
}) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/zones?history=1", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "기록을 불러오지 못했습니다");
      setEntries(data as HistoryEntry[]);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const jibun = (pnu: string) => propsOf.get(pnu)?.jibun ?? pnu;

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-950/70 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex max-h-[85vh] w-[560px] max-w-[94vw] flex-col rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-center gap-2 border-b border-slate-800 px-4 py-3">
          <span className="text-sm font-semibold text-slate-100">변경 기록</span>
          <span className="text-[11px] text-slate-500">최근 200건 · 구역 편입·제외와 명부 수정</span>
          <button
            onClick={load}
            className="ml-auto rounded-md border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-800"
          >
            새로고침
          </button>
          <button
            onClick={onClose}
            aria-label="닫기"
            className="rounded-md px-2 py-1 text-sm text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
          {error && <p className="py-4 text-xs text-red-300">{error}</p>}
          {!error && !entries && <p className="py-4 text-xs text-slate-500">불러오는 중…</p>}
          {entries?.length === 0 && (
            <p className="py-4 text-xs text-slate-500">아직 기록이 없습니다. 이제부터 바뀌는 것이 쌓입니다.</p>
          )}

          <ul className="divide-y divide-slate-800">
            {entries?.map((e) => {
              const list = e.pnus ?? [];
              const expanded = open.has(e.id);
              const shown = expanded ? list : list.slice(0, SHOWN);
              return (
                <li key={e.id} className="py-2.5 text-xs">
                  <div className="flex items-baseline gap-2">
                    <span
                      className={`font-semibold ${DANGER.has(e.action) ? "text-red-400" : "text-emerald-400"}`}
                    >
                      {ACTION[e.action] ?? e.action}
                    </span>
                    {list.length > 0 && <span className="text-slate-300">{list.length}필지</span>}
                    {e.jibun && <span className="text-slate-300">논현동 {e.jibun}</span>}
                    {e.zoneName && <span className="truncate text-slate-500">{e.zoneName}</span>}
                    <span className="ml-auto shrink-0 text-slate-500">{when(e.at)}</span>
                  </div>

                  {list.length > 0 && (
                    <div className="mt-1 leading-relaxed text-slate-400">
                      {shown.map(jibun).join(", ")}
                      {list.length > SHOWN && (
                        <button
                          onClick={() =>
                            setOpen((prev) => {
                              const next = new Set(prev);
                              if (expanded) next.delete(e.id);
                              else next.add(e.id);
                              return next;
                            })
                          }
                          className="ml-1 text-slate-300 underline-offset-2 hover:underline"
                        >
                          {expanded ? "접기" : `외 ${list.length - SHOWN}필지 더 보기`}
                        </button>
                      )}
                    </div>
                  )}

                  {e.kind === "consent" && (
                    <div className="mt-1 text-slate-400">
                      {brief(e.before)} → {e.action === "delete" ? "없음" : brief(e.after)}
                    </div>
                  )}
                  {e.action === "setOwners" && (
                    <div className="mt-1 text-slate-400">
                      {String(e.before ?? "없음")} → {String(e.after ?? "없음")}명
                    </div>
                  )}

                  <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-500">
                    <span>{e.user}</span>
                    <span>·</span>
                    <span title={e.agent}>{device(e.agent)}</span>
                    {e.ip && (
                      <>
                        <span>·</span>
                        <span>{e.ip}</span>
                      </>
                    )}
                    {(e.action === "remove" || e.action === "clear") && e.zoneId && list.length > 0 && (
                      <button
                        disabled={busy}
                        onClick={async () => {
                          if (await onRestore(e.zoneId!, list)) load();
                        }}
                        className="ml-auto rounded-md bg-emerald-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
                      >
                        다시 넣기
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
