import { NextResponse } from "next/server";
import { ADMIN_COOKIE, cookieOptions, currentAdmin, loginPin } from "@/lib/admin";

export const dynamic = "force-dynamic";

/** 지금 들어와 있는 상태인지 */
export async function GET() {
  const admin = await currentAdmin();
  return NextResponse.json({ admin });
}

/** 관리자번호로 들어가기 */
export async function POST(req: Request) {
  let input: { pin?: string };
  try {
    input = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청 본문" }, { status: 400 });
  }

  const pin = String(input.pin ?? "").trim();
  if (!/^\d{4}$/.test(pin)) {
    return NextResponse.json({ error: "관리자번호 4자리를 넣어 주세요" }, { status: 400 });
  }

  const result = await loginPin(pin);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, result.token, cookieOptions);
  return res;
}

/** 나가기 */
export async function DELETE() {
  const res = NextResponse.json({ admin: null });
  res.cookies.set(ADMIN_COOKIE, "", { ...cookieOptions, maxAge: 0 });
  return res;
}
