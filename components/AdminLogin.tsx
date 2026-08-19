"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 관리자 로그인 창.
 * 아이디·비밀번호는 서버(/api/admin)에서 확인하고, 통과하면 서명된 쿠키가 심긴다.
 */
export default function AdminLogin({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const firstField = useRef<HTMLInputElement>(null);

  useEffect(() => firstField.current?.focus(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "로그인에 실패했습니다");
      onSuccess();
    } catch (err) {
      setError((err as Error).message);
      setPassword("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-950/70 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <form
        onSubmit={submit}
        className="w-[300px] rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
      >
        <h2 className="text-sm font-semibold text-slate-100">관리자 로그인</h2>
        <p className="mt-1 text-[11px] text-slate-500">
          구역 편집과 소유자 수 변경에 필요합니다.
        </p>

        <label className="mt-4 block text-[11px] text-slate-400">아이디</label>
        <input
          ref={firstField}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm outline-none focus:border-emerald-500"
        />

        <label className="mt-3 block text-[11px] text-slate-400">비밀번호</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm outline-none focus:border-emerald-500"
        />

        {error && <p className="mt-2 text-[11px] text-red-300">{error}</p>}

        <div className="mt-4 flex gap-2">
          <button
            type="submit"
            disabled={busy || !username || !password}
            className="flex-1 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "확인 중…" : "로그인"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-300 transition hover:bg-slate-800"
          >
            취소
          </button>
        </div>
      </form>
    </div>
  );
}
