import QRCode from "qrcode";

import { kommuneBySlug } from "@/lib/kommune";
import { appUrl } from "@/lib/mail";

/** A QR code (SVG, for print) pointing to a municipality's public page. */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const k = await kommuneBySlug(slug);
  if (!k) return new Response("Nicht gefunden", { status: 404 });
  const svg = await QRCode.toString(appUrl(`/${k.slug}`), { type: "svg", margin: 2, errorCorrectionLevel: "M" });
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Content-Disposition": `attachment; filename="streit-bar-${k.slug}-qr.svg"`,
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
