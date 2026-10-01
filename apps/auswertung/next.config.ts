import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@policy/db", "@policy/landkarte", "@policy/llm"],
  // The Agent SDK spawns the Claude CLI — keep it out of the server bundle.
  serverExternalPackages: ["@anthropic-ai/claude-agent-sdk"],
};

export default nextConfig;
