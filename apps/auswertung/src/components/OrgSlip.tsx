import { DiagMark, shortOrg } from "@policy/landkarte";
import type { SlipEntry } from "@policy/landkarte/data/organisations";

/** What the automatic check found before the machine editor acted (intake.v2 flags). */
export const FLAG: Record<string, string> = {
  several_claims: "mehrere Behauptungen in einer Stelle",
  mixed_fact_value: "Tatsache und Wertung vermischt",
  not_standalone: "ohne Zusammenhang nicht verständlich",
  not_neutral: "nicht neutral formuliert",
  personal_data: "personenbezogene Angaben",
  meta: "Bemerkung über das Verfahren",
  off_topic: "nicht zum Thema",
  role_uncertain: "Rolle im Argument unsicher",
  demand_as_claim: "Forderung als Behauptung formuliert",
  fact_value_uncertain: "Tatsache oder Wertung unsicher",
};

const flagText = (flags: string[]) => flags.map((f) => FLAG[f] ?? f).join(", ");

/** Many editor notes were logged in English; say so instead of hiding them. */
const looksEnglish = (s: string) => /\b(the|and|was|were|into|with|split|claim|point)\b/i.test(s);

/** PDF line breaks inside the quote: join hyphenated words, keep "Wärme- und". */
export function cleanQuote(q: string): string {
  return q
    .replace(/-\s*\n\s*(?=(und|oder|bzw|sowie)\b)/g, "- ")
    .replace(/(\p{Ll})-\s*\n\s*(\p{Ll})/gu, "$1$2")
    .replace(/\s*\n\s*/g, " ")
    .trim();
}

export const plural = (n: number, one: string, many: string) => `${n.toLocaleString("de-DE")} ${n === 1 ? one : many}`;

/** One plain sentence: what happened to the wording of this argument. */
export function textFate(e: SlipEntry): string {
  if (e.status === "rejected") {
    const found = e.edit?.flagsAfter.length ? e.edit.flagsAfter : (e.edit?.flagsBefore ?? []);
    const f = found.length ? ` (${flagText(found)})` : "";
    return e.edit?.action === "rewrite" || e.edit?.action === "split"
      ? `Die maschinelle Redaktion hat es überarbeitet, die erneute Prüfung fand weiter einen Mangel${f}. Deshalb aussortiert.`
      : `Von der automatischen Prüfung aussortiert${f}.`;
  }
  const parts: string[] = [];
  if (e.firstBy) {
    parts.push(`Dasselbe Argument hat auch ${shortOrg(e.firstBy)} vorgebracht; die Maschine hat beide als ein Argument erkannt, es steht in deren Fassung.`);
  } else {
    const a = e.edit?.action ?? null;
    const why = e.edit?.flagsBefore.length ? ` Grund: ${flagText(e.edit.flagsBefore)}.` : "";
    if (a === "rewrite") parts.push(`Von der maschinellen Redaktion umformuliert.${why}`);
    else if (a === "split")
      parts.push(
        e.edit && e.edit.pieces > 1
          ? `Eines von ${e.edit.pieces} Argumenten aus einer Textstelle, die die maschinelle Redaktion geteilt hat.${why}`
          : `Aus einer Textstelle herausgelöst, die die maschinelle Redaktion geteilt hat.${why}`,
      );
    else if (a === "keep")
      parts.push(
        `Die automatische Prüfung meldete einen Verdacht (${flagText(e.edit?.flagsBefore ?? []) || "ohne Angabe"}); die maschinelle Redaktion hat ihn geprüft und das Argument unverändert gelassen.`,
      );
    else parts.push("Unverändert aus dem Text übernommen.");
  }
  if (e.folded.length)
    parts.push(
      e.folded.length === 1
        ? "Eine gleichlautende Fassung aus dieser Stellungnahme hat die Maschine damit zusammengelegt."
        : `${e.folded.length} gleichlautende Fassungen aus dieser Stellungnahme hat die Maschine damit zusammengelegt.`,
    );
  return parts.join(" ");
}

/** One argument on the Laufzettel: the argument, what happened to its wording, and (margin) where it landed. */
export function SlipRow({ e, base, org }: { e: SlipEntry; base: string; org: string }) {
  const reason = e.edit?.reason && !e.firstBy ? e.edit.reason : null;
  const hasMore = Boolean(e.summary || e.quotes.length || reason || e.folded.length || e.mergedInto);
  return (
    <div className="row org-arg">
      <div className="row-main">
        <p className="org-arg-label">{e.label}</p>
        {hasMore ? (
          <details className="org-arg-more">
            <summary>{textFate(e)}</summary>
            {e.summary ? (
              <p className="org-arg-summary">
                <span className="org-k">{e.status === "released" ? "So steht es jetzt: " : "Fassung der Maschine: "}</span>
                {e.summary}
              </p>
            ) : null}
            {e.quotes.map((q, i) => (
              <blockquote key={i} className="lk-quote">
                <p>„{cleanQuote(q)}“</p>
                <footer>Originalstelle, {org}</footer>
              </blockquote>
            ))}
            {e.quotes.length === 0 && e.status !== "merged" ? <p className="small muted">Für diese Stelle ist kein Originalzitat gespeichert.</p> : null}
            {reason ? (
              <p className="small org-arg-reason">
                <span className="org-k">Begründung der maschinellen Redaktion{looksEnglish(reason) ? " (auf Englisch protokolliert)" : ""}: </span>
                <span lang={looksEnglish(reason) ? "en" : undefined}>{reason}</span>
              </p>
            ) : null}
            {e.folded.length ? (
              <div className="small org-arg-reason">
                <span className="org-k">{e.folded.length === 1 ? "Die zusammengelegte Fassung: " : "Die zusammengelegten Fassungen: "}</span>
                <ul>
                  {e.folded.map((f, i) => (
                    <li key={i}>{f.label}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </details>
        ) : (
          <p className="small muted org-arg-fate">{textFate(e)}</p>
        )}
      </div>
      <aside className="margin">
        <Landing e={e} base={base} />
      </aside>
    </div>
  );
}

function Landing({ e, base }: { e: SlipEntry; base: string }) {
  if (e.status === "rejected") return <div>Nicht in die Auswertung aufgenommen</div>;
  if (e.status === "merged" && e.mergedInto) {
    const others = e.mergedInto.by.map(shortOrg);
    return (
      <>
        <div>
          Zusammengelegt mit „{e.mergedInto.label}“
          {others.length ? <span className="muted"> ({others.join(", ")})</span> : null}
        </div>
        {e.mergedInto.mapPointId ? (
          <div>
            <a href={`${base}/punkt/${e.mergedInto.mapPointId}`}>Zur Streitfrage</a>
          </div>
        ) : null}
      </>
    );
  }
  return (
    <>
      {e.mapPoint ? (
        <div className="org-landing">
          <DiagMark diag={e.mapPoint.diag} />
          <span>
            <span className="muted">Streitfrage: </span>
            <a href={`${base}/punkt/${e.mapPoint.id}`} title={e.mapPoint.text}>
              {e.mapPoint.label}
            </a>
          </span>
        </div>
      ) : e.kind === "gap" ? (
        <div>Offene Frage: keiner Streitfrage zugeordnet</div>
      ) : (
        <div>Einzelforderung: keiner Streitfrage zugeordnet</div>
      )}
      {e.alsoBy.length ? <div className="muted">Auch gesagt von {e.alsoBy.map(shortOrg).join(", ")}</div> : null}
    </>
  );
}
