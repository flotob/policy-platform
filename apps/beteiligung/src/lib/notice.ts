/**
 * A short notice carried in a redirect (`?hinweis=…`), signed: pages show only notices this server wrote.
 * Otherwise anyone could build a link that prints their own text in the town's official notice box.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const sign = (text: string) => createHmac("sha256", process.env.BETTER_AUTH_SECRET ?? "dev").update(`hinweis|${text}`).digest("base64url").slice(0, 16);

/** The query string for a redirect: `hinweis=…&hs=…`. */
export const noticeQuery = (text: string) => `hinweis=${encodeURIComponent(text)}&hs=${sign(text)}`;

/** The notice to show, or null when it was not signed here. */
export function readNotice(text: string | undefined, signature: string | undefined): string | null {
  if (!text || !signature) return null;
  const want = Buffer.from(sign(text));
  const got = Buffer.from(signature);
  return want.length === got.length && timingSafeEqual(want, got) ? text : null;
}
