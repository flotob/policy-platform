import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@policy/db", "@policy/landkarte", "@policy/llm", "@policy/pipeline"],
  // The Agent SDK spawns the Claude CLI; the PDF/DOCX readers ship their own workers — keep them out of the bundle.
  serverExternalPackages: ["@anthropic-ai/claude-agent-sdk", "unpdf", "mammoth"],
  // Statements and statutes are uploaded through server actions (20 MB per file).
  experimental: { serverActions: { bodySizeLimit: "21mb" } },
};

export default nextConfig;
