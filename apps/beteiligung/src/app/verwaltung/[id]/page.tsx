import Link from "next/link";
import { notFound } from "next/navigation";

import { getCampaign, inviteCounts, listFiles } from "@/lib/campaigns";
import { STEPS } from "@/lib/params";
import { openingCheck } from "@/lib/redaktion";
import { requireStaff } from "@/lib/session";

import { deleteFile, openCampaign, setState } from "../actions";
import { BasicsForm, InviteForm, JustificationForm, ProcessForm, UploadForm } from "../forms";

const ROLE = { entwurf: "Entwurf", unterlage: "Unterlage", stellungnahme: "Stellungnahme" } as const;
const kb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} MB`);

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  const c = await getCampaign(staff.tenant.id, (await params).id);
  return { title: c?.title ?? "Verfahren" };
}

export default async function CampaignPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ fehler?: string }> }) {
  const staff = await requireStaff();
  const { id } = await params;
  const { fehler } = await searchParams;
  const campaign = await getCampaign(staff.tenant.id, id);
  if (!campaign) notFound();
  const [files, open, invites] = await Promise.all([listFiles(campaign.id), openingCheck(campaign.consultationId), inviteCounts(campaign.id)]);
  const editable = staff.role === "initiator";
  const preparing = campaign.state === "entwurf" || campaign.state === "vorbereitung";
  const publicPath = `/${staff.tenant.slug}/${campaign.slug}`;
  const stepsDone = STEPS.filter((s) => campaign.steps[s.key]).length;
  const statements = files.filter((f) => f.role === "stellungnahme").length;

  const setup = [
    { done: true, text: "Maßnahme und Entscheidungsfrage stehen." },
    { done: !!campaign.summary, text: "Eine kurze Erklärung für Bürgerinnen und Bürger." },
    { done: stepsDone === 4, text: `Die Begründung in vier Schritten (${stepsDone} von 4).` },
    { done: files.some((f) => f.role === "entwurf"), text: "Der Entwurf ist hochgeladen (optional)." },
    {
      done: statements > 0,
      text: statements ? `${statements} vorhandene ${statements === 1 ? "Stellungnahme" : "Stellungnahmen"} (optional).` : "Vorhandene Stellungnahmen (optional).",
    },
  ];
  const opening = [
    { done: open.hasSkeleton && open.skeletonOpen === 0, text: open.hasSkeleton ? `Die Redaktion hat über das Startgerüst entschieden${open.skeletonOpen ? ` (noch ${open.skeletonOpen} offen)` : ""}.` : "Die Maschine hat das Startgerüst noch nicht vorgeschlagen." },
    { done: open.rootReleased, text: "Die Entscheidungsfrage selbst steht als Aussage zur Abstimmung." },
    { done: open.stepsCovered === 4, text: `Jeder der vier Schritte hat mindestens eine freigegebene Aussage (${open.stepsCovered} von 4).` },
  ];
  const ready = opening.every((c) => c.done);

  return (
    <div className="cp-body">
      <nav className="cp-nav" aria-label="Abschnitte">
        <a href="#massnahme">Die Maßnahme</a>
        <a href="#begruendung">Begründung</a>
        <a href="#ablauf">Ablauf</a>
        <a href="#unterlagen">Unterlagen</a>
        <a href="#freischalten">Vorbereiten und freischalten</a>
      </nav>

      <div className="cp-sections">
        <section id="massnahme" className="cp-section">
          <h2>Die Maßnahme</h2>
          {editable ? (
            <BasicsForm id={campaign.id} title={campaign.title} question={campaign.question} measure={campaign.measure} summary={campaign.summary} />
          ) : (
            <p>{campaign.measure}</p>
          )}
        </section>

        <section id="begruendung" className="cp-section">
          <h2>Begründung</h2>
          {fehler === "begruendung" ? (
            <p className="notice">Für die Vorbereitung braucht die Begründung alle vier Schritte. Jeder Beitrag wird später einem davon zugeordnet.</p>
          ) : null}
          {campaign.state === "vorbereitung" && open.hasSkeleton ? (
            <p className="notice">
              Die Maschine hat aus dieser Begründung schon das Startgerüst gemacht. Wenn Sie hier etwas ändern, lassen Sie das Gerüst unter{" "}
              <Link href={`/verwaltung/${campaign.id}/punkte`}>Begründung und Einwände</Link> neu vorschlagen, solange noch nichts davon freigegeben ist.
            </p>
          ) : null}
          {editable ? <JustificationForm id={campaign.id} justification={campaign.justification} steps={campaign.steps} /> : null}
        </section>

        <section id="ablauf" className="cp-section">
          <h2>Ablauf</h2>
          {editable ? <ProcessForm id={campaign.id} params={campaign.params} /> : null}
          {editable && campaign.params.access === "einladung" ? (
            <>
              <h3 className="cp-h3">Einladungscodes</h3>
              <InviteForm id={campaign.id} total={invites.total} used={invites.used} />
            </>
          ) : null}
        </section>

        <section id="unterlagen" className="cp-section">
          <h2>Unterlagen</h2>
          <p className="muted cp-lead">
            Der Entwurf, Gutachten und Stellungnahmen, die schon eingegangen sind. Stellungnahmen zerlegt die Maschine in einzelne Beiträge; jedes
            Zitat führt später auf die Stelle im Original zurück.
          </p>
          {files.length ? (
            <ul className="file-list">
              {files.map((f) => (
                <li key={f.id}>
                  <span className="tag">{ROLE[f.role]}</span>
                  <span className="file-name">{f.filename}</span>
                  <span className="muted small">
                    {f.sender ? `${f.sender}, ` : ""}
                    {kb(f.size)}
                    {f.role === "stellungnahme" && f.read ? `, ${f.moves} ${f.moves === 1 ? "Beitrag" : "Beiträge"}` : ""}
                  </span>
                  {editable && preparing && !f.read ? (
                    <form action={deleteFile.bind(null, campaign.id, f.id)}>
                      <button type="submit" className="btn btn-quiet btn-small">
                        Entfernen
                      </button>
                    </form>
                  ) : (
                    <span />
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">Noch keine Unterlagen.</p>
          )}
          {files.some((f) => f.read) ? (
            <p className="small muted">Gelesene Stellungnahmen bleiben: Ihre Beiträge sind schon in der Redaktion.</p>
          ) : null}
          {editable && preparing ? <UploadForm id={campaign.id} /> : null}
        </section>

        <section id="freischalten" className="cp-section">
          <h2>Vorbereiten und freischalten</h2>
          {campaign.state === "entwurf" ? (
            <>
              <ul className="checklist">
                {setup.map((c) => (
                  <li key={c.text} className={c.done ? "done" : undefined}>
                    <span className="tick" aria-hidden>
                      {c.done ? "✓" : ""}
                    </span>
                    {c.text}
                  </li>
                ))}
              </ul>
              <p className="cp-lead">
                Bei der Vorbereitung zerlegt die Maschine Ihre Begründung und die Stellungnahmen in einzelne Aussagen. Ihre Redaktion prüft sie,
                dann schalten Sie die Beteiligung frei. Solange können Sie alles ändern.
              </p>
              {editable ? (
                <form action={setState.bind(null, campaign.id, "vorbereitung")} className="cp-back">
                  <button type="submit" className="btn" disabled={stepsDone < 4}>
                    Vorbereitung starten
                  </button>
                </form>
              ) : null}
            </>
          ) : campaign.state === "vorbereitung" ? (
            <>
              <p className="cp-lead">
                Freischalten können Sie, sobald die Redaktion über das Startgerüst entschieden hat. Beiträge aus den Stellungnahmen, die dann noch
                warten, kommen in die Abstimmung, sobald sie freigegeben sind.
              </p>
              <ul className="checklist">
                {opening.map((c) => (
                  <li key={c.text} className={c.done ? "done" : undefined}>
                    <span className="tick" aria-hidden>
                      {c.done ? "✓" : ""}
                    </span>
                    {c.text}
                  </li>
                ))}
              </ul>
              <p className="small muted">
                {open.released} {open.released === 1 ? "Aussage ist" : "Aussagen sind"} freigegeben
                {open.waiting ? `, ${open.waiting} neue Punkte warten in der Redaktion` : ""}.
              </p>
              {editable ? (
                <div className="cp-actions">
                  <form action={openCampaign.bind(null, campaign.id)}>
                    <button type="submit" className="btn" disabled={!ready}>
                      Beteiligung freischalten
                    </button>
                  </form>
                  <Link href={publicPath} className="btn btn-quiet">
                    Öffentliche Startseite ansehen
                  </Link>
                  <form action={setState.bind(null, campaign.id, "entwurf")}>
                    <button type="submit" className="btn btn-quiet btn-small">
                      Zurück zum Entwurf
                    </button>
                  </form>
                </div>
              ) : null}
            </>
          ) : campaign.state === "offen" ? (
            <>
              <p className="cp-lead">Die Beteiligung ist freigeschaltet. Neue Beiträge landen in der Redaktion. Schließen können Sie sie unter Auswertung.</p>
              <p className="cp-back">
                <Link href={publicPath} className="btn btn-quiet">
                  Öffentliche Seite ansehen
                </Link>
              </p>
            </>
          ) : (
            <>
              <p className="cp-lead">
                {campaign.state === "veroeffentlicht"
                  ? "Die Beteiligung ist abgeschlossen; Bericht und Ergebnis sind veröffentlicht."
                  : "Die Beteiligung ist geschlossen. Ergebnis und Bericht entstehen unter Auswertung und Bericht."}
              </p>
              <p className="cp-back">
                <Link href={`/verwaltung/${campaign.id}/${campaign.state === "auswertung" ? "auswertung" : "bericht"}`} className="btn btn-quiet">
                  {campaign.state === "auswertung" ? "Zur Auswertung" : "Zum Bericht"}
                </Link>{" "}
                <Link href={publicPath} className="btn btn-quiet">
                  Öffentliche Seite ansehen
                </Link>
              </p>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
