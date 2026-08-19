/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  /**
   * 개발 서버가 .next 를 쓰고 있는 동안 프로덕션 빌드를 돌리면
   * 서로 산출물을 덮어써 빌드가 깨진다. 그럴 때만 출력 폴더를 따로 준다.
   *   NEXT_DIST_DIR=.next-build npm run build
   */
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
