import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@policy/db", "@policy/landkarte"],
  // Statements and statutes are uploaded through server actions (20 MB per file).
  experimental: { serverActions: { bodySizeLimit: "21mb" } },
};

export default nextConfig;
