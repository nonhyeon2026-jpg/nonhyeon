import AppShell from "@/components/AppShell";
import { readConsent } from "@/lib/consentStore";
import { readBoundary, readZones } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Page() {
  const [zones, boundary, consent] = await Promise.all([
    readZones(),
    readBoundary(),
    readConsent(),
  ]);

  return (
    <AppShell
      initialZones={zones}
      boundary={boundary}
      consent={consent}
      naverClientId={process.env.NEXT_PUBLIC_NAVER_MAP_CLIENT_ID ?? ""}
      naverKeyParam={process.env.NEXT_PUBLIC_NAVER_KEY_PARAM ?? "ncpKeyId"}
    />
  );
}
