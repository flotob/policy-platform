import { logoOf } from "@/lib/kommune";

/** A municipality's logo. SVGs are served sandboxed: opened on their own, no script in them can run. */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const logo = await logoOf(slug);
  if (!logo) return new Response("Kein Logo", { status: 404 });
  return new Response(new Uint8Array(logo.bytes), {
    headers: {
      "Content-Type": logo.type,
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
    },
  });
}
