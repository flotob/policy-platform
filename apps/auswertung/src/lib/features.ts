/**
 * "Frag die Landkarte" starts a language-model call per question. On in dev;
 * in production only with ASK_ENABLED=1 (then it needs ANTHROPIC_API_KEY and
 * a limit — see README).
 */
export const askEnabled = () => process.env.NODE_ENV !== "production" || process.env.ASK_ENABLED === "1";
