import AppShell from "@/components/AppShell";
import { readConsent } from "@/lib/consentStore";
import { readBoundary, readZones } from "@/lib/store";
import type { ConsentMap } from "@/lib/consent";
import type { Zone } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Page() {
  const boundary = await readBoundary();

  /**
   * DB 가 안 붙어도 지도는 떠야 한다.
   * 서버 컴포넌트에서 예외가 그대로 올라가면 화면 전체가 500 이 되어
   * 무엇이 잘못됐는지조차 알 수 없다.
   */
  let zones: Zone[] = [];
  let consent: ConsentMap = {};
  let dataError: string | null = null;

  try {
    [zones, consent] = await Promise.all([readZones(), readConsent()]);
  } catch (e) {
    dataError =
      "데이터베이스에 연결하지 못했습니다. /api/health 에서 원인을 확인하세요. " +
      (e as Error).message.replace(/mongodb(\+srv)?:\/\/[^\s"]*/gi, "mongodb://<가려짐>");
    console.error("[page] MongoDB 조회 실패:", e);
  }

  return (
    <AppShell
      initialZones={zones}
      boundary={boundary}
      consent={consent}
      dataError={dataError}
      naverClientId={process.env.NEXT_PUBLIC_NAVER_MAP_CLIENT_ID ?? ""}
      naverKeyParam={process.env.NEXT_PUBLIC_NAVER_KEY_PARAM ?? "ncpKeyId"}
    />
  );
}
