import type { ReactNode } from "react";

import type { Move } from "@/lib/redaktion";
import { BELEG } from "@/lib/vocab";

/**
 * One move as evidence: the verbatim passage, who wrote it, and the
 * paragraph around it (I4: every point leads back to the place in the
 * original). A contradicting move carries the disagree colour.
 */
export function Quote({ move, note, children }: { move: Move; note?: ReactNode; children?: ReactNode }) {
  return (
    <figure className={`quote${move.stance === -1 ? " against" : ""}`}>
      <blockquote>„{move.quote.replace(/\s+/g, " ").trim()}“</blockquote>
      <figcaption>
        <strong>{move.sender}</strong>
        {move.typ !== "W" && move.beleg !== "keine" ? <span className="muted"> · {BELEG[move.beleg as keyof typeof BELEG] ?? move.beleg}</span> : null}
        {move.stance === -1 ? <span className="stance-against"> · widerspricht dieser Aussage</span> : null}
      </figcaption>
      {note ? <div className="quote-note">{note}</div> : null}
      <details className="quote-ctx">
        <summary>Im Zusammenhang lesen</summary>
        <p>
          {move.context.before}
          <mark>{move.context.hit}</mark>
          {move.context.after}
        </p>
        {move.filename ? <p className="small muted">Aus „{move.filename}“</p> : null}
      </details>
      {children ? <div className="quote-actions">{children}</div> : null}
    </figure>
  );
}
