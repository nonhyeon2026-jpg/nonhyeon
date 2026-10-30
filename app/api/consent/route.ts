import { NextResponse } from "next/server";
import { currentAdmin } from "@/lib/admin";
import { consentBrief, recordHistory } from "@/lib/history";
import { deleteConsent, normalizeConsent, readConsent, saveConsent } from "@/lib/consentStore";
import type { ConsentInput } from "@/lib/types";

export const dynamic = "force-dynamic";

const fail = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

/** 명부를 고치는 요청은 로그인된 관리자만. 통과하면 변경 기록에 남길 아이디를 돌려준다 */
async function requireAdmin(): Promise<{ user: string } | { denied: NextResponse }> {
  const user = await currentAdmin();
  return user ? { user } : { denied: fail("관리자 로그인이 필요합니다", 401) };
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
  const auth = await requireAdmin();
  if ("denied" in auth) return auth.denied;

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
    const before = (await readConsent())[pnu];
    const saved = await saveConsent(normalizeConsent(pnu, jibun, input));
    await recordHistory(auth.user, {
      kind: "consent",
      action: "save",
      pnu,
      jibun,
      // 딸림 지번으로 걸린 다른 지번의 문서는 이 지번의 이전 값이 아니다
      before: consentBrief(before?.pnu === pnu ? before : null),
      after: consentBrief(saved),
    });
    return NextResponse.json(saved);
  } catch (e) {
    return fail((e as Error).message, 500);
  }
}

/** 명부에서 지번 빼기 */
export async function DELETE(req: Request) {
  const auth = await requireAdmin();
  if ("denied" in auth) return auth.denied;

  const pnu = new URL(req.url).searchParams.get("pnu");
  if (!pnu) return fail("pnu 가 필요합니다");

  try {
    const before = (await readConsent())[pnu];
    await deleteConsent(pnu);
    await recordHistory(auth.user, {
      kind: "consent",
      action: "delete",
      pnu,
      jibun: before?.jibun,
      // 지운 문서를 통째로 남겨 되살릴 수 있게 한다
      before: before?.pnu === pnu ? before : null,
    });
    return NextResponse.json({ pnu, removed: true });
  } catch (e) {
    return fail((e as Error).message, 500);
  }
}
