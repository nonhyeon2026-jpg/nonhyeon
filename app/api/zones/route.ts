import { NextResponse } from "next/server";
import { currentAdmin } from "@/lib/admin";
import { createZone, deleteZone, mutateZones, readZones } from "@/lib/store";
import type { ZoneMutation } from "@/lib/types";

export const dynamic = "force-dynamic";

const fail = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

/** 구역을 바꾸는 요청은 로그인된 관리자만 — 화면에서 버튼을 숨기는 것만으로는 못 막는다 */
async function requireAdmin() {
  return (await currentAdmin()) ? null : fail("관리자 로그인이 필요합니다", 401);
}

async function body<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

export async function GET() {
  return NextResponse.json(await readZones());
}

/** 구역 생성 */
export async function POST(req: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const input = await body<Record<string, unknown>>(req);
  if (!input) return fail("잘못된 요청 본문");
  try {
    return NextResponse.json(await createZone(input));
  } catch (e) {
    return fail((e as Error).message);
  }
}

/** 구역 삭제 */
export async function DELETE(req: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const zoneId = new URL(req.url).searchParams.get("zoneId");
  if (!zoneId) return fail("zoneId 가 필요합니다");
  try {
    return NextResponse.json(await deleteZone(zoneId));
  } catch (e) {
    return fail((e as Error).message, 404);
  }
}

/** 필지 편입 / 제외 */
export async function PATCH(req: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const m = await body<ZoneMutation>(req);
  if (!m) return fail("잘못된 요청 본문");
  if (!m.zoneId || !["add", "remove", "clear", "setOwners"].includes(m.action)) {
    return fail("action / zoneId 가 필요합니다");
  }
  if (m.action === "setOwners") {
    if (typeof m.owners !== "number" || !Number.isFinite(m.owners) || m.owners < 1) {
      return fail("owners 는 1 이상의 숫자여야 합니다");
    }
  } else if (m.action !== "clear" && !Array.isArray(m.pnus)) {
    return fail("pnus 배열이 필요합니다");
  }

  try {
    return NextResponse.json(await mutateZones(m));
  } catch (e) {
    return fail((e as Error).message, 404);
  }
}
