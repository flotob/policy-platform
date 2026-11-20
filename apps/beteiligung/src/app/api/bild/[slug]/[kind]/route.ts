import { imageOf, type ImageKind } from "@/lib/kommune";

const KINDS = new Set<ImageKind>(["titelbild", "portrait"]);

/** A municipality's title photo or greeting portrait (photos only: PNG, JPG, WebP, checked on upload). */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; kind: string }> }) {
  const { slug, kind } = await params;
  if (!KINDS.has(kind as ImageKind)) return new Response("Unbekannt", { status: 404 });
  const img = await imageOf(slug, kind as ImageKind);
  if (!img) return new Response("Kein Bild", { status: 404 });
  return new Response(new Uint8Array(img.bytes), {
    headers: {
      "Content-Type": img.type,
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
