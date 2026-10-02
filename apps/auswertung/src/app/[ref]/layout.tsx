import type { ReactNode } from "react";

import { PathNav, type PathItem } from "@/components/PathNav";
import { overview } from "@/lib/load";

export default async function ConsultationLayout({ children, params }: { children: ReactNode; params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const o = await overview(ref);
  const base = `/${o.ref}`;
  const items: PathItem[] = [
    { href: base, label: "Lagebild" },
    { href: `${base}/gesetz`, label: o.draft.title },
    ...o.measures.map((m, i) => ({
      href: `${base}/massnahmen/${m.slug}`,
      label: m.display,
      tone: m.verdict.tone,
      sub: true,
      group: i === 0 ? "Die Teilentscheidungen" : undefined,
    })),
    { href: `${base}/gutachten`, label: "Gutachten-Agenda", group: "Werkzeuge" },
    { href: `${base}/organisationen`, label: "Organisationen" },
    { href: `${base}/abstimmen`, label: "Wo stehen Sie?" },
    { href: `${base}/fragen`, label: "Frag die Landkarte" },
    { href: `${base}/bericht`, label: "Bericht zum Drucken" },
    { href: `${base}/methode`, label: "Wie die Karte entsteht" },
  ];
  return (
    <div className="sheet">
      <nav className="path" aria-label="Auswertung">
        <a className="path-title" href={base}>
          <strong>{o.title.replace(/\s*\(.*\)\s*$/, "")}</strong>
          <span>
            {o.procedure}, {o.stats.statements} Stellungnahmen
          </span>
        </a>
        <PathNav items={items} />
        <p className="path-foot">Prototyp. Alle Inhalte stammen aus den echten Stellungnahmen; Voten sind aus deren Text abgeleitet.</p>
      </nav>
      <main>{children}</main>
    </div>
  );
}
