/**
 * Outgoing email (invitations, password reset) through Resend's HTTP API — no SDK needed.
 * RESEND_API_KEY switches sending on; MAIL_FROM is the sender ("streit.bar <post@streit.bar>"),
 * MAIL_REPLY_TO an optional reply address. Without a key the mail is printed to the server log
 * (local development), and on the public server the caller learns that nothing went out.
 * Addresses under .test never get mail (the demo accounts live there).
 */

export interface Mail {
  to: string;
  subject: string;
  /** Plain text; the HTML version is made from it (paragraphs, links). */
  text: string;
}

export type MailResult = { ok: true; logged?: boolean } | { ok: false; reason: string };

const DEFAULT_FROM = "streit.bar <post@streit.bar>";

/** The public address links in emails point to (BETTER_AUTH_URL on the server, localhost in development). */
export function appUrl(path = "/"): string {
  const base = (process.env.BETTER_AUTH_URL || "http://localhost:3300").replace(/\/+$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

export const mailConfigured = () => Boolean(process.env.RESEND_API_KEY?.trim());

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Plain text → simple HTML: blank lines make paragraphs, URLs become links. */
function toHtml(text: string): string {
  const paras = text
    .trim()
    .split(/\n{2,}/)
    .map((p) => esc(p).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>').replace(/\n/g, "<br>"));
  return `<!doctype html><html lang="de"><body style="font-family: Georgia, 'Times New Roman', serif; font-size: 16px; line-height: 1.5; color: #1d2421; max-width: 560px; margin: 0 auto; padding: 24px;">${paras
    .map((p) => `<p style="margin: 0 0 14px;">${p}</p>`)
    .join("")}</body></html>`;
}

export async function sendMail(mail: Mail): Promise<MailResult> {
  const to = mail.to.trim();
  const key = process.env.RESEND_API_KEY?.trim();
  if (/\.test$/i.test(to) && process.env.NODE_ENV === "production") return { ok: true, logged: true };
  if (!key || /\.test$/i.test(to)) {
    if (process.env.NODE_ENV === "production") {
      console.error(`[mail] RESEND_API_KEY is not set — "${mail.subject}" to ${to} was not sent`);
      return { ok: false, reason: "not_configured" };
    }
    console.log(`[mail] (not sent, no RESEND_API_KEY)\nAn: ${to}\nBetreff: ${mail.subject}\n\n${mail.text}\n[mail] end`);
    return { ok: true, logged: true };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.MAIL_FROM?.trim() || DEFAULT_FROM,
        to: [to],
        subject: mail.subject,
        text: mail.text,
        html: toHtml(mail.text),
        ...(process.env.MAIL_REPLY_TO?.trim() ? { reply_to: process.env.MAIL_REPLY_TO.trim() } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 300);
      console.error(`[mail] Resend refused "${mail.subject}" to ${to}: ${res.status} ${body}`);
      return { ok: false, reason: `resend_${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    console.error(`[mail] sending "${mail.subject}" to ${to} failed:`, e);
    return { ok: false, reason: "network" };
  }
}
