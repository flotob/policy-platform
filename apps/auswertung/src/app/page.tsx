import { listConsultations } from "@policy/landkarte/data";

import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/** The consultations with a Landkarte — the desk officer picks her file. */
export default async function Home() {
  const all = await listConsultations(getDb());
  return (
    <div className="sheet sheet-plain">
      <main>
        <header>
          <h1>Auswertungen</h1>
          <p className="lead">Jede Akte ist eine echte Anhörung oder Konsultation, ausgewertet aus den eingegangenen Stellungnahmen.</p>
        </header>
        <ul className="files">
          {all.map((c) => (
            <li key={c.ref}>
              <a href={`/${c.ref}`}>
                <strong>{c.title.replace(/\s*\(.*\)\s*$/, "")}</strong>
                <span>
                  {c.statements} Stellungnahmen, {c.measures} Teilentscheidungen, {c.mapPoints} Streitfragen
                </span>
              </a>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
