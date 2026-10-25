import type { Job } from "@/lib/redaktion";

import { retryJob } from "@/app/verwaltung/actions";

import { AutoRefresh } from "./AutoRefresh";

const sum = (jobs: Job[], k: string) => jobs.reduce((s, j) => s + Number((j.result as Record<string, number> | null)?.[k] ?? 0), 0);

/** One line on what the machine is doing for this campaign, or what it found. */
export function MachineStatus({ campaignId, jobs, editable }: { campaignId: string; jobs: Job[]; editable: boolean }) {
  if (!jobs.length) return null;
  const running = jobs.find((j) => j.state === "laeuft");
  const waiting = jobs.filter((j) => j.state === "wartet").length;
  const done = jobs.filter((j) => j.state === "fertig");
  const failed = jobs.filter((j) => j.state === "fehler");
  const busy = !!running || waiting > 0;
  const last = jobs[jobs.length - 1];
  const evaluating = last?.kind === "lagernamen" || last?.kind === "bericht";
  const read = done.filter((j) => j.kind === "zerlegen");
  const moves = sum(read, "moves");
  const known = read.reduce((s, j) => {
    const r = (j.result?.routes ?? {}) as Record<string, number>;
    return s + (r.auto ?? 0) + (r.unsicher ?? 0) + (r.gegenteil ?? 0);
  }, 0);

  return (
    <div className={`machine${busy ? " busy" : ""}`} role="status">
      <AutoRefresh active={busy} />
      {busy ? (
        <p>
          <span className="pulse" aria-hidden />
          <strong>Die Maschine arbeitet.</strong>{" "}
          {running
            ? running.kind === "skelett"
              ? "Sie zerlegt Ihre Begründung in einzelne Aussagen."
              : running.kind === "lagernamen"
                ? "Sie schlägt Namen für die Lager vor."
                : running.kind === "bericht"
                  ? "Sie schreibt den Bericht und lässt ihn gegenlesen. Das dauert ein bis zwei Minuten."
                  : running.kind === "kurzaussage"
                    ? "Sie liest einen eigenen Punkt aus der Beteiligung."
                    : `Sie liest „${running.filename ?? "eine Stellungnahme"}“${running.sender ? ` (${running.sender})` : ""}.`
            : "Sie fängt gleich an."}{" "}
          <span className="muted num">
            {done.length} von {jobs.length} Aufgaben erledigt. Die Seite aktualisiert sich von selbst.
          </span>
        </p>
      ) : evaluating ? (
        <p>
          <strong>Die Maschine ist fertig.</strong>{" "}
          {done.some((j) => j.kind === "lagernamen") ? "Sie hat Namen für die Lager vorgeschlagen. " : ""}
          {done.some((j) => j.kind === "bericht") ? "Sie hat den Bericht geschrieben und gegenlesen lassen. " : ""}
          Entscheiden muss jetzt die Redaktion.
        </p>
      ) : (
        <p>
          <strong>Die Maschine ist fertig.</strong>{" "}
          {read.length
            ? `Sie hat ${read.length} ${read.length === 1 ? "Stellungnahme" : "Stellungnahmen"} in ${moves} einzelne Beiträge zerlegt; ${
                known === 0 ? "alle bringen neue Punkte" : `${known} davon ${known === 1 ? "gehört" : "gehören"} zu Punkten, die schon da waren`
              }. `
            : ""}
          Entscheiden muss jetzt die Redaktion.
        </p>
      )}
      {failed.map((j) => (
        <div key={j.id} className="machine-fail">
          <p>
            <strong>
              {j.kind === "skelett" ? "Die Begründung" : j.kind === "lagernamen" ? "Der Vorschlag für die Lagernamen" : j.kind === "bericht" ? "Der Bericht" : j.kind === "kurzaussage" ? "Ein eigener Punkt" : `„${j.filename ?? "Datei"}“`}{" "}
              ließ sich nicht verarbeiten.
            </strong> {j.error}
          </p>
          {editable ? (
            <form action={retryJob.bind(null, campaignId, j.id)}>
              <button type="submit" className="btn btn-quiet btn-small">
                Erneut versuchen
              </button>
            </form>
          ) : null}
        </div>
      ))}
    </div>
  );
}
