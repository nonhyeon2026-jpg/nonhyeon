import { NextResponse } from "next/server";
import { CONSENT_COLLECTION, DB_NAME, ZONE_COLLECTION, mongoDb } from "@/lib/mongo";

export const dynamic = "force-dynamic";

/**
 * 배포 점검용. MongoDB 에 붙는지, 자료가 들어 있는지만 알려준다.
 * 접속 문자열은 절대 내보내지 않는다 — 설정 여부만 true/false 로 표시한다.
 */
export async function GET() {
  const env = {
    MONGODB_URI: Boolean(process.env.MONGODB_URI),
    MONGODB_DB: process.env.MONGODB_DB ?? "(기본값 nonhyun)",
    NEXT_PUBLIC_NAVER_MAP_CLIENT_ID: Boolean(process.env.NEXT_PUBLIC_NAVER_MAP_CLIENT_ID),
  };

  try {
    const db = await mongoDb();
    const [zones, consent] = await Promise.all([
      db.collection(ZONE_COLLECTION).countDocuments(),
      db.collection(CONSENT_COLLECTION).countDocuments(),
    ]);
    return NextResponse.json({ ok: true, db: DB_NAME, zones, consent, env });
  } catch (e) {
    const message = (e as Error).message;
    return NextResponse.json(
      {
        ok: false,
        // 접속 문자열이 섞여 들어가지 않도록 사용자·호스트 부분을 지운다
        error: message.replace(/mongodb(\+srv)?:\/\/[^\s"]*/gi, "mongodb://<가려짐>"),
        env,
      },
      { status: 503 },
    );
  }
}
