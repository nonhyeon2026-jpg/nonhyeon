"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const PIN_LENGTH = 4;

/**
 * 앱 대문. 관리자번호 4자리를 넣어야 지도로 들어간다.
 * 번호는 서버(/api/admin)에서 확인하고, 맞으면 서명된 쿠키가 심긴 뒤 페이지를 다시 그린다.
 * 4자리를 다 넣으면 바로 확인한다 — 단추를 따로 누르지 않아도 된다.
 */
export default function AdminGate({ dataError }: { dataError?: string | null }) {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.focus(), []);

  const submit = async (value: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "들어가지 못했습니다");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setPin("");
      setBusy(false);
      input.current?.focus();
    }
  };

  const onChange = (raw: string) => {
    const value = raw.replace(/\D/g, "").slice(0, PIN_LENGTH);
    setPin(value);
    if (value.length === PIN_LENGTH) submit(value);
  };

  return (
    <div className="flex h-full items-center justify-center bg-slate-950 px-4 text-slate-100">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (pin.length === PIN_LENGTH) submit(pin);
        }}
        className="w-full max-w-[320px] rounded-2xl border border-slate-800 bg-slate-900 p-6 text-center shadow-2xl"
      >
        <h1 className="text-lg font-semibold">논현동 공도복</h1>
        <p className="mt-1 text-xs text-slate-400">논현1동 재개발 도심공공주택복합사업</p>

        <label htmlFor="admin-pin" className="mt-6 block text-[11px] text-slate-400">
          관리자번호
        </label>
        {/* 칸 네 개는 보여 주기만 하고, 실제 입력은 위에 겹친 투명한 입력칸 하나가 받는다 */}
        <div className="relative mx-auto mt-2 w-fit" onClick={() => input.current?.focus()}>
          <div className="flex gap-2">
            {Array.from({ length: PIN_LENGTH }, (_, i) => (
              <div
                key={i}
                className={`flex h-12 w-11 items-center justify-center rounded-lg border text-xl ${
                  i === pin.length && !busy ? "border-emerald-500" : "border-slate-700"
                } bg-slate-950`}
              >
                {i < pin.length ? "●" : ""}
              </div>
            ))}
          </div>
          <input
            ref={input}
            id="admin-pin"
            value={pin}
            onChange={(e) => onChange(e.target.value)}
            disabled={busy}
            type="password"
            inputMode="numeric"
            pattern="\d*"
            autoComplete="off"
            maxLength={PIN_LENGTH}
            className="absolute inset-0 h-full w-full cursor-text opacity-0"
          />
        </div>

        <p className="mt-3 min-h-[1rem] text-[11px] text-red-300">
          {busy ? <span className="text-slate-400">확인 중…</span> : error}
        </p>
        {dataError && <p className="mt-2 text-[10px] leading-snug text-amber-300">{dataError}</p>}
      </form>
    </div>
  );
}
