import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@policy/db", "@policy/contracts", "@policy/math", "@policy/pipeline"],
};

export default withNextIntl(nextConfig);
