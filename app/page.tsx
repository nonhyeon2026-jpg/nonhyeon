import AdminGate from "@/components/AdminGate";
import AppShell from "@/components/AppShell";
import { currentAdmin } from "@/lib/admin";
import { readConsent } from "@/lib/consentStore";
import { readBoundary, readZones } from "@/lib/store";
import type { ConsentMap } from "@/lib/consent";
import type { Zone } from "@/lib/types";

export const dynamic = "force-dynamic";

const dbError = (e: unknown) =>
  "데이터베이스에 연결하지 못했습니다. /api/health 에서 원인을 확인하세요. " +
  (e as Error).message.replace(/mongodb(\+srv)?:\/\/[^\s"]*/gi, "mongodb://<가려짐>");

export default async function Page() {
  /**
   * 대문 — 관리자번호로 들어온 사람만 지도와 명부를 본다. 번호를 확인하는 서명키도 DB 에 있어
   * DB 가 안 붙으면 들어올 수 없다. 그때는 대문에 원인을 띄운다.
   */
  let admin: string | null = null;
  try {
    admin = await currentAdmin();
  } catch (e) {
    console.error("[page] 관리자 확인 실패:", e);
    return <AdminGate dataError={dbError(e)} />;
  }
  if (!admin) return <AdminGate />;

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
    dataError = dbError(e);
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
