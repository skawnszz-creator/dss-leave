import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // NAS(Synology DS218+)의 Docker 컨테이너로 옮기기 위한 설정.
  // 빌드 결과가 .next/standalone 아래에 자립 실행 가능한 형태로 나온다.
  output: "standalone",
};

export default nextConfig;
