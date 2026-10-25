import Link from "next/link";
import { notFound } from "next/navigation";

import { getCampaign, listFiles } from "@/lib/campaigns";
import { STATES, STEPS } from "@/lib/params";
import { requireStaff } from "@/lib/session";

import { deleteFile, setState } from "../actions";
import { BasicsForm, JustificationForm, ProcessForm, UploadForm } from "../forms";

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
  const files = await listFiles(campaign.id);
  const editable = staff.role === "initiator";
  const publicPath = `/${staff.tenant.slug}/${campaign.slug}`;
  const stepsDone = STEPS.filter((s) => campaign.steps[s.key]).length;
  const statements = files.filter((f) => f.role === "stellungnahme").length;

  const checklist = [
    { done: true, text: "Maßnahme und Entscheidungsfrage stehen." },
    { done: !!campaign.summary, text: "Eine kurze Erklärung für Bürgerinnen und Bürger." },
    { done: stepsDone === 4, text: `Die Begründung in vier Schritten (${stepsDone} von 4).` },
    { done: files.some((f) => f.role === "entwurf"), text: "Der Entwurf ist hochgeladen (optional)." },
    {
      done: statements > 0,
      text: statements ? `${statements} vorhandene ${statements === 1 ? "Stellungnahme" : "Stellungnahmen"} (optional).` : "Vorhandene Stellungnahmen (optional).",
    },
  ];

  return (
    <div className="cp">
      <div className="cp-head">
        <p className="crumbs">
          <Link href="/verwaltung">Verfahren</Link>
        </p>
        <h1 className="ws-h1">{campaign.title}</h1>
        <p className="cp-q serif">{campaign.question}</p>
        <div className="cp-meta">
          <span className={`state state-${campaign.state}`}>{STATES[campaign.state].label}</span>
          {campaign.fictional ? <span className="tag">Beispiel mit erfundenen Inhalten</span> : null}
          <span className="muted small">{STATES[campaign.state].text}</span>
        </div>
      </div>

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
            {editable ? <JustificationForm id={campaign.id} justification={campaign.justification} steps={campaign.steps} /> : null}
          </section>

          <section id="ablauf" className="cp-section">
            <h2>Ablauf</h2>
            {editable ? <ProcessForm id={campaign.id} params={campaign.params} /> : null}
          </section>

          <section id="unterlagen" className="cp-section">
            <h2>Unterlagen</h2>
            <p className="muted cp-lead">
              Der Entwurf, Gutachten und Stellungnahmen, die schon eingegangen sind. Bei der Vorbereitung zerlegt die Maschine sie in einzelne
              Aussagen; jedes Zitat führt später auf die Stelle im Original zurück.
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
                    </span>
                    {editable && campaign.state === "entwurf" ? (
                      <form action={deleteFile.bind(null, campaign.id, f.id)}>
                        <button type="submit" className="btn btn-quiet btn-small">
                          Entfernen
                        </button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small">Noch keine Unterlagen.</p>
            )}
            {editable && campaign.state === "entwurf" ? <UploadForm id={campaign.id} /> : null}
          </section>

          <section id="freischalten" className="cp-section">
            <h2>Vorbereiten und freischalten</h2>
            <ul className="checklist">
              {checklist.map((c) => (
                <li key={c.text} className={c.done ? "done" : undefined}>
                  <span className="tick" aria-hidden>
                    {c.done ? "✓" : ""}
                  </span>
                  {c.text}
                </li>
              ))}
            </ul>
            {campaign.state === "entwurf" ? (
              <>
                <p className="cp-lead">
                  Bei der Vorbereitung zerlegt die Maschine Begründung und Unterlagen in einzelne Aussagen. Ihre Redaktion prüft sie, dann schalten Sie
                  die Beteiligung frei. Solange können Sie alles ändern.
                </p>
                {editable ? (
                  <form action={setState.bind(null, campaign.id, "vorbereitung")}>
                    <button type="submit" className="btn" disabled={stepsDone < 4}>
                      Vorbereitung starten
                    </button>
                  </form>
                ) : null}
              </>
            ) : campaign.state === "vorbereitung" ? (
              <>
                <p className="cp-lead">
                  Die Vorbereitung ist angestoßen. Sobald die Redaktion die ersten Aussagen freigegeben hat, schalten Sie hier die Beteiligung frei. Die
                  öffentliche Startseite ist schon erreichbar und kündigt die Beteiligung an.
                </p>
                <p>
                  <Link href={publicPath} className="btn btn-quiet">
                    Öffentliche Startseite ansehen
                  </Link>
                </p>
                {editable ? (
                  <form action={setState.bind(null, campaign.id, "entwurf")} className="cp-back">
                    <button type="submit" className="btn btn-quiet btn-small">
                      Zurück zum Entwurf
                    </button>
                  </form>
                ) : null}
              </>
            ) : (
              <p>
                <Link href={publicPath} className="btn btn-quiet">
                  Öffentliche Seite ansehen
                </Link>
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
