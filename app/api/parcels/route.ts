import { readFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { NextResponse } from "next/server";
import { currentAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";

/**
 * 필지 GeoJSON (data/parcels.json). 관리자번호로 들어온 사람에게만 준다.
 *
 * 예전엔 public/ 정적 파일이라 주소만 알면 누구나 받았다. 4.4MB 로 Vercel 함수 응답 한도
 * (4.5MB)에 걸리므로 미리 gzip 해 둔 것(약 0.5MB)을 그대로 내보낸다. 파일은 배포 뒤 바뀌지
 * 않으니 한 번 읽어 압축한 것을 함수가 살아 있는 동안 재사용한다.
 */
let cached: Promise<Buffer> | null = null;

const load = () =>
  (cached ??= readFile(path.join(process.cwd(), "data", "parcels.json")).then((b) => gzipSync(b)));

export async function GET() {
  if (!(await currentAdmin())) {
    return NextResponse.json({ error: "관리자번호를 넣고 들어와야 합니다" }, { status: 401 });
  }
  let body: Buffer;
  try {
    body = await load();
  } catch (e) {
    cached = null;
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Encoding": "gzip",
      // 들어온 사람의 브라우저에만 담아 둔다
      "Cache-Control": "private, max-age=3600",
    },
  });
}
