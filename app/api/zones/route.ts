import { NextResponse } from "next/server";
import { currentAdmin } from "@/lib/admin";
import { readHistory, recordHistory } from "@/lib/history";
import { createZone, deleteZone, mutateZones, readZones } from "@/lib/store";
import type { Zone, ZoneMutation } from "@/lib/types";

export const dynamic = "force-dynamic";

const fail = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

/**
 * 구역을 바꾸는 요청은 로그인된 관리자만 — 화면에서 버튼을 숨기는 것만으로는 못 막는다.
 * 통과하면 변경 기록에 남길 아이디를 돌려준다.
 */
async function requireAdmin(): Promise<{ user: string } | { denied: NextResponse }> {
  const user = await currentAdmin();
  return user ? { user } : { denied: fail("관리자 로그인이 필요합니다", 401) };
}

async function body<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  // ?history=1 — 구역·명부 변경 기록 (관리자만)
  if (new URL(req.url).searchParams.has("history")) {
    const auth = await requireAdmin();
    if ("denied" in auth) return auth.denied;
    return NextResponse.json(await readHistory());
  }
  return NextResponse.json(await readZones());
}

/** 구역 생성 */
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if ("denied" in auth) return auth.denied;

  const input = await body<Record<string, unknown>>(req);
  if (!input) return fail("잘못된 요청 본문");
  try {
    const zones = await createZone(input);
    const made = zones.find((z) => z.name === String(input.name ?? "").trim());
    await recordHistory(auth.user, {
      kind: "zone",
      action: "createZone",
      zoneId: made?.id,
      zoneName: made?.name,
    });
    return NextResponse.json(zones);
  } catch (e) {
    return fail((e as Error).message);
  }
}

/** 구역 삭제 */
export async function DELETE(req: Request) {
  const auth = await requireAdmin();
  if ("denied" in auth) return auth.denied;

  const zoneId = new URL(req.url).searchParams.get("zoneId");
  if (!zoneId) return fail("zoneId 가 필요합니다");
  try {
    const gone = (await readZones()).find((z) => z.id === zoneId);
    const zones = await deleteZone(zoneId);
    // 구역을 통째로 지우면 필지 목록이 사라지므로 기록에 남겨 둔다 — 되살릴 수 있게
    await recordHistory(auth.user, {
      kind: "zone",
      action: "deleteZone",
      zoneId,
      zoneName: gone?.name,
      pnus: gone?.parcels,
      before: gone,
    });
    return NextResponse.json(zones);
  } catch (e) {
    return fail((e as Error).message, 404);
  }
}

/** 필지 편입 / 제외 */
export async function PATCH(req: Request) {
  const auth = await requireAdmin();
  if ("denied" in auth) return auth.denied;

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
    const before = await readZones();
    const after = await mutateZones(m);
    await recordZoneChange(auth.user, m, before, after);
    return NextResponse.json(after);
  } catch (e) {
    return fail((e as Error).message, 404);
  }
}

/**
 * 편입·제외는 요청한 필지가 아니라 실제로 들고 난 필지를 남긴다.
 * 편입은 다른 구역에서 필지를 빼 오기도 하므로 그 구역의 빠진 필지도 따로 한 줄 남긴다.
 */
async function recordZoneChange(user: string, m: ZoneMutation, before: Zone[], after: Zone[]) {
  const was = new Map(before.map((z) => [z.id, z]));
  for (const z of after) {
    const prev = was.get(z.id);
    if (!prev) continue;
    if (z.id === m.zoneId && m.action === "setOwners") {
      if (prev.owners !== z.owners) {
        await recordHistory(user, {
          kind: "zone",
          action: "setOwners",
          zoneId: z.id,
          zoneName: z.name,
          before: prev.owners ?? null,
          after: z.owners ?? null,
        });
      }
      continue;
    }
    const had = new Set(prev.parcels);
    const has = new Set(z.parcels);
    const added = z.parcels.filter((p) => !had.has(p));
    const removed = prev.parcels.filter((p) => !has.has(p));
    const base = { kind: "zone" as const, zoneId: z.id, zoneName: z.name };
    if (added.length) await recordHistory(user, { ...base, action: "add", pnus: added });
    if (removed.length) {
      await recordHistory(user, {
        ...base,
        action: z.id === m.zoneId && m.action === "clear" ? "clear" : "remove",
        pnus: removed,
      });
    }
  }
}
