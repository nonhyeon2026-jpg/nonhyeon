import { NextResponse } from "next/server";
import { currentAdmin } from "@/lib/admin";
import { deleteConsent, normalizeConsent, readConsent, saveConsent } from "@/lib/consentStore";
import type { ConsentInput } from "@/lib/types";

export const dynamic = "force-dynamic";

const fail = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

/** 명부를 고치는 요청은 로그인된 관리자만 */
async function requireAdmin() {
  return (await currentAdmin()) ? null : fail("관리자 로그인이 필요합니다", 401);
}

export async function GET() {
  try {
    return NextResponse.json(await readConsent());
  } catch (e) {
    return fail((e as Error).message, 503);
  }
}

/** 지번 하나의 참여의향서 정보 저장 (없으면 새로 만든다) */
export async function PUT(req: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  let input: ConsentInput & { pnu?: string; jibun?: string };
  try {
    input = await req.json();
  } catch {
    return fail("잘못된 요청 본문");
  }

  const pnu = String(input.pnu ?? "").trim();
  const jibun = String(input.jibun ?? "").trim();
  if (!pnu || !jibun) return fail("pnu 와 jibun 이 필요합니다");

  try {
    return NextResponse.json(await saveConsent(normalizeConsent(pnu, jibun, input)));
  } catch (e) {
    return fail((e as Error).message, 500);
  }
}

/** 명부에서 지번 빼기 */
export async function DELETE(req: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const pnu = new URL(req.url).searchParams.get("pnu");
  if (!pnu) return fail("pnu 가 필요합니다");

  try {
    await deleteConsent(pnu);
    return NextResponse.json({ pnu, removed: true });
  } catch (e) {
    return fail((e as Error).message, 500);
  }
}
