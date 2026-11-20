import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Served with next start from a full workspace image (Dockerfile.beteiligung), not standalone.
  transpilePackages: ["@policy/db", "@policy/llm", "@policy/math", "@policy/pipeline"],
  // The Agent SDK spawns the Claude CLI; the PDF/DOCX readers ship their own workers — keep them out of the bundle.
  serverExternalPackages: ["@anthropic-ai/claude-agent-sdk", "unpdf", "mammoth"],
  // Statements and statutes are uploaded through server actions: 20 MB per file, 40 MB for a statement
  // with its attachments in one go (lib/absender.ts UPLOAD).
  experimental: { serverActions: { bodySizeLimit: "41mb" } },
};

export default nextConfig;
