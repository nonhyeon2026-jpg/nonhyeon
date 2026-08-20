import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "논현동 공도복",
  description: "논현1동 재개발 도심공공주택복합사업 구역을 지번 단위로 확인하고 참여의향서 제출 현황을 관리합니다.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className="h-full">
      <body className="h-full">{children}</body>
    </html>
  );
}
