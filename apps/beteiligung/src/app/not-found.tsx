import Link from "next/link";

import { SiteHeader } from "@/components/SiteHeader";

export const metadata = { title: "Seite nicht gefunden" };

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="wrap narrow" style={{ paddingBlock: "64px" }}>
        <h1 className="serif" style={{ fontSize: "34px", fontWeight: 600 }}>
          Diese Seite gibt es nicht
        </h1>
        <p className="muted" style={{ marginTop: "12px", maxWidth: "52ch" }}>
          Vielleicht ist der Link unvollständig, oder das Verfahren ist noch nicht freigeschaltet. Die Adresse einer Beteiligung hat die Form
          „/stadt/thema“.
        </p>
        <p style={{ marginTop: "24px" }}>
          <Link href="/" className="btn btn-quiet">
            Zur Startseite
          </Link>
        </p>
      </main>
    </>
  );
}
