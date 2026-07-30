/**
 * Live smoke test: one real structured call through the Agent SDK using the
 * local Claude Code authentication (Max subscription on a dev machine).
 *
 * Run: pnpm --filter @policy/llm smoke
 */

import { AgentSdkProvider } from "../src/agent-sdk.ts";

const provider = new AgentSdkProvider();

const schema = {
  type: "object",
  properties: {
    claims: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          kind: { type: "string", enum: ["fact", "value"] },
        },
        required: ["text", "kind"],
        additionalProperties: false,
      },
    },
  },
  required: ["claims"],
  additionalProperties: false,
};

const submission =
  "Die Netzkapazität in Neubaugebieten reicht nachweislich aus, das zeigen " +
  "unsere Messdaten. Und niemand hat das Recht, mir vorzuschreiben, was auf " +
  "mein Dach kommt.";

const result = await provider.generateStructured<{
  claims: { text: string; kind: string }[];
}>({
  system:
    "Extract the distinct claims from the consultation submission. " +
    "Label each claim 'fact' (empirically checkable) or 'value' (normative).",
  prompt: submission,
  schema,
});

console.log(JSON.stringify(result.output, null, 2));
console.log("provenance:", JSON.stringify(result.provenance));

const kinds = result.output.claims.map((c) => c.kind).sort();
if (result.output.claims.length >= 2 && kinds.includes("fact") && kinds.includes("value")) {
  console.log("SMOKE: PASS — subscription-auth structured call works");
} else {
  console.log("SMOKE: UNEXPECTED OUTPUT SHAPE (call itself succeeded)");
}
