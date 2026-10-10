import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "**/*": [
      "./node_modules/pg-cloudflare/dist/**",
      "./node_modules/pg-cloudflare/esm/**",
    ],
  },
  // These packages are server-only or client-only heavy modules.
  // Marking them external keeps them out of the SSR bundle that Workers
  // parses on every cold start — significantly reduces CPU usage.
  serverExternalPackages: [
    "@aws-sdk/client-s3",
    "@aws-sdk/lib-storage",
    "bullmq",
    "ioredis",
  ],
  // framer-motion is ESM-only and client-only. Transpiling it lets Next.js
  // properly tree-shake it and avoid bundling it into the SSR worker path.
  transpilePackages: ["framer-motion"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
      {
        protocol: "https",
        hostname: "*.amazonaws.com",
      },
    ],
  },
};

export default nextConfig;
