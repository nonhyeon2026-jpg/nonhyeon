/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  /**
   * 개발 서버가 .next 를 쓰고 있는 동안 프로덕션 빌드를 돌리면
   * 서로 산출물을 덮어써 빌드가 깨진다. 그럴 때만 출력 폴더를 따로 준다.
   *   NEXT_DIST_DIR=.next-build npm run build
   */
  distDir: process.env.NEXT_DIST_DIR || ".next",
  experimental: {
    /**
     * 필지 파일은 /api/parcels 가 fs 로 읽는다. 경로를 실행 중에 만들어 서버리스 배포(Vercel)가
     * 함수 번들에 넣을 파일로 알아채지 못하므로 직접 넣으라고 알려 준다.
     */
    outputFileTracingIncludes: {
      "/api/parcels": ["./data/parcels.json"],
    },
  },
};

export default nextConfig;
