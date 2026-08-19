import { NextResponse } from "next/server";
import { ADMIN_COOKIE, cookieOptions, currentAdmin, login } from "@/lib/admin";

export const dynamic = "force-dynamic";

/** 지금 로그인 상태인지 */
export async function GET() {
  const admin = await currentAdmin();
  return NextResponse.json({ admin });
}

/** 로그인 */
export async function POST(req: Request) {
  let input: { username?: string; password?: string };
  try {
    input = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청 본문" }, { status: 400 });
  }

  const username = String(input.username ?? "").trim();
  const password = String(input.password ?? "");
  if (!username || !password) {
    return NextResponse.json({ error: "아이디와 비밀번호를 입력하세요" }, { status: 400 });
  }

  const token = await login(username, password);
  if (!token) {
    // 아이디가 틀렸는지 비밀번호가 틀렸는지는 알려주지 않는다
    return NextResponse.json({ error: "아이디 또는 비밀번호가 맞지 않습니다" }, { status: 401 });
  }

  const res = NextResponse.json({ admin: username });
  res.cookies.set(ADMIN_COOKIE, token, cookieOptions);
  return res;
}

/** 로그아웃 */
export async function DELETE() {
  const res = NextResponse.json({ admin: null });
  res.cookies.set(ADMIN_COOKIE, "", { ...cookieOptions, maxAge: 0 });
  return res;
}
