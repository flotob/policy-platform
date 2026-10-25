import type { Absatz, Satz } from "@policy/pipeline/kern";
import { SECTIONS, type SectionKey } from "@policy/pipeline/kern";
import type { ReactNode } from "react";

/** "[A14]" in the report text becomes a link to that statement on the results page. */
function linked(text: string, href: string | null): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(/\[A(\d+)\]/g)) {
    out.push(text.slice(last, m.index));
    out.push(
      href ? (
        <a key={m.index} className="rp-ref" href={`${href}#a${m[1]}`} title={`Aussage ${m[1]} auf der Ergebnisseite`}>
          A{m[1]}
        </a>
      ) : (
        <span key={m.index} className="rp-ref">
          A{m[1]}
        </span>
      ),
    );
    last = (m.index ?? 0) + m[0].length;
  }
  out.push(text.slice(last));
  return out;
}

/** The report (R2) by section; with `ids`, every paragraph shows the sentence IDs it renders (R3 traceability). */
export function ReportText({ text, resultsHref, ids = false, flagged = [] }: { text: Absatz[]; resultsHref: string | null; ids?: boolean; flagged?: number[] }) {
  const order = Object.keys(SECTIONS) as SectionKey[];
  const sections = order.map((key) => ({ key, ps: text.map((a, i) => ({ a, n: i + 1 })).filter(({ a }) => a.abschnitt === key) })).filter((s) => s.ps.length);
  return (
    <div className="rp-text">
      {sections.map((s) => (
        <section key={s.key}>
          <h2>{SECTIONS[s.key]}</h2>
          {s.ps.map(({ a, n }) => (
            <div key={n} className={`rp-p${flagged.includes(n) ? " flagged" : ""}`}>
              <p>{linked(a.text, resultsHref)}</p>
              {ids ? (
                <span className="rp-ids num" aria-label="Gibt diese Sätze der Schlussfolgerungsliste wieder">
                  Absatz {n} · {a.saetze.join(", ")}
                </span>
              ) : null}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

/** R1, the binding list: what the text may say, and nothing else. */
export function SentenceList({ sentences, resultsHref }: { sentences: Satz[]; resultsHref: string | null }) {
  const order = Object.keys(SECTIONS) as SectionKey[];
  return (
    <ol className="rp-list">
      {order.flatMap((key) =>
        sentences
          .filter((s) => s.section === key)
          .map((s) => (
            <li key={s.id}>
              <span className="rp-sid num">{s.id}</span>
              <span>{linked(s.text, resultsHref)}</span>
            </li>
          )),
      )}
    </ol>
  );
}
