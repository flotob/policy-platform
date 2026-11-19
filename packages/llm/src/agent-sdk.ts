/**
 * Provider backed by the Claude Agent SDK.
 *
 * Auth is inherited from the local Claude Code runtime: on a dev machine
 * that's the developer's Max-subscription login (or CLAUDE_CODE_OAUTH_TOKEN
 * from `claude setup-token`); in production, ANTHROPIC_API_KEY takes
 * precedence automatically — same code, different env.
 *
 * ⚠ Subscription auth is for OUR OWN development/evaluation only. Serving
 * third parties on claude.ai login is not permitted — production tenants run
 * on metered API keys (see roadmap §4 and Anthropic's Agent SDK docs).
 *
 * Calls are pure text→JSON: no tools, single turn, schema-constrained output.
 */

import { query } from "@anthropic-ai/claude-agent-sdk";

import {
  type GenerateRequest,
  type GenerateResult,
  type LlmProvider,
  promptHash,
} from "./provider.ts";

const DEFAULT_MODEL = process.env.LLM_MODEL ?? "claude-sonnet-5-5";

export class AgentSdkProvider implements LlmProvider {
  readonly name = "agent-sdk";

  async generateStructured<T = unknown>(
    req: GenerateRequest,
  ): Promise<GenerateResult<T>> {
    const model = req.model ?? DEFAULT_MODEL;
    const startedAt = new Date();

    let output: T | undefined;
    let resultText: string | undefined;
    // With attachments the prompt is one user message with content blocks (a PDF as document, images as image).
    const prompt = req.attachments?.length
      ? (async function* () {
          yield {
            type: "user",
            parent_tool_use_id: null,
            session_id: "",
            message: {
              role: "user",
              content: [
                ...req.attachments!.map((a) =>
                  a.mediaType === "application/pdf"
                    ? { type: "document", source: { type: "base64", media_type: a.mediaType, data: a.data } }
                    : { type: "image", source: { type: "base64", media_type: a.mediaType, data: a.data } },
                ),
                { type: "text", text: req.prompt },
              ],
            },
          };
        })()
      : req.prompt;
    for await (const message of query({
      prompt: prompt as never,
      options: {
        model,
        systemPrompt: req.system,
        allowedTools: [],
        maxTurns: 3, // schema-validation retries need extra turns
        outputFormat: { type: "json_schema", schema: req.schema },
      } as never,
    })) {
      if (message.type === "result") {
        const result = message as unknown as {
          subtype: string;
          structured_output?: T;
          result?: string;
        };
        if (result.subtype === "success") {
          output = result.structured_output;
          resultText = result.result;
        } else {
          throw new Error(`agent-sdk call failed: ${result.subtype}`);
        }
      }
    }

    if (output === undefined && resultText !== undefined) {
      // Defensive fallback: some SDK versions deliver JSON as result text.
      output = JSON.parse(resultText) as T;
    }
    if (output === undefined) {
      throw new Error("agent-sdk call produced no structured output");
    }

    return {
      output,
      provenance: {
        provider: this.name,
        model,
        promptHash: promptHash(req),
        startedAt: startedAt.toISOString(),
        durationMs: Date.now() - startedAt.getTime(),
      },
    };
  }
}
