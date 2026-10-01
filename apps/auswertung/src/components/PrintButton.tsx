"use client";

/** Opens the browser's print dialog (there: "Als PDF speichern"). Hidden in print. */
export function PrintButton({ label = "Als PDF speichern" }: { label?: string }) {
  return (
    <span className="no-print" style={{ display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: "0.4rem 0.75rem" }}>
      <button type="button" className="btn btn-primary" onClick={() => window.print()}>
        {label}
      </button>
      <span className="small muted">Öffnet den Druckdialog. Dort „Als PDF speichern“ wählen.</span>
    </span>
  );
}
