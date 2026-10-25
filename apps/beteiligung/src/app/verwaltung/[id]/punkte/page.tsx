import Link from "next/link";
import { notFound } from "next/navigation";

import { getCampaign } from "@/lib/campaigns";
import { QUESTIONS, STEPS } from "@/lib/params";
import { listNodes, openingCheck, type Node } from "@/lib/redaktion";
import { requireStaff } from "@/lib/session";
import { TYP } from "@/lib/vocab";

import { reproposeSkeleton } from "../../actions";
import { editNodeAction } from "../redaktion/actions";
import { NodeEditor } from "../redaktion/NodeEditor";
import "../redaktion.css";

export const metadata = { title: "Begründung und Einwände" };

const names = (n: Node) => {
  const s = n.senders.filter((x) => x !== "Ohne Absender");
  return s.length > 3 ? `${s.slice(0, 3).join(", ")} und ${s.length - 3} weitere` : s.join(", ");
};

/**
 * The argument as it stands (Stephan's "Nach Argument", in preparation): the
 * measure, the town's four steps, under each what supports and what attacks
 * it — and the critical questions nobody has asked yet (the gap monitor,
 * B12/W6, from day one).
 */
export default async function Punkte({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ bearbeiten?: string; fehler?: string }> }) {
  const staff = await requireStaff();
  const { id } = await params;
  const sp = await searchParams;
  const campaign = await getCampaign(staff.tenant.id, id);
  if (!campaign) notFound();
  const [nodes, open] = await Promise.all([listNodes(campaign.consultationId), openingCheck(campaign.consultationId)]);
  const canEdit = staff.role !== "betrachter" && (campaign.state === "vorbereitung" || campaign.state === "offen");
  const root = nodes.find((n) => n.rolle === "schluss");
  const drafts = nodes.filter((n) => n.status === "draft").length;

  const row = (n: Node) => (
    <li key={n.id} id={`p-${n.id}`} className={`pt pt-${n.status}${n.richtung === "greift_an" ? " pt-att" : ""}`}>
      <p className="pt-text">{n.text}</p>
      {n.einwand && n.richtung === "greift_an" ? <p className="pt-einwand small">Einwand: „{n.einwand}“</p> : null}
      <p className="pt-meta small">
        <span className={`typ typ-${n.typ}`}>{TYP[n.typ].label}</span>
        {n.status === "draft" ? <span className="tag">Vorschlag</span> : null}
        {n.status === "released" && n.releasedBy?.startsWith("ki") ? <span className="tag tag-ki">von der Maschine freigegeben</span> : null}
        {n.agree + n.disagree ? (
          <span className="muted">
            {n.agree ? `${n.agree} ${n.agree === 1 ? "Beitrag" : "Beiträge"} dafür` : ""}
            {n.agree && n.disagree ? ", " : ""}
            {n.disagree ? `${n.disagree} dagegen` : ""}
            {names(n) ? ` · ${names(n)}` : ""}
          </span>
        ) : null}
        {n.status === "draft" ? (
          <Link href={`/verwaltung/${id}/redaktion?punkt=${n.id}`}>in der Redaktion entscheiden</Link>
        ) : canEdit ? (
          <Link href={`?bearbeiten=${n.id}#p-${n.id}`} scroll={false}>
            Bearbeiten
          </Link>
        ) : null}
      </p>
      {canEdit && sp.bearbeiten === n.id && n.status === "released" ? (
        <div className="pt-edit">
          {sp.fehler ? <p className="error">{sp.fehler}</p> : null}
          {campaign.state === "offen" ? (
            <p className="notice small">
              Die Abstimmung läuft. Eine neue Formulierung wird eine neue Fassung: Alle werden noch einmal gefragt, die bisherigen Stimmen bleiben bei
              der alten Fassung.
            </p>
          ) : null}
          <NodeEditor key={n.id} node={n} action={editNodeAction.bind(null, id, n.id)} submitLabel="Änderung speichern" />
          <Link href={`?#p-${n.id}`} className="small">
            Abbrechen
          </Link>
        </div>
      ) : null}
    </li>
  );

  if (!root && !nodes.length) {
    return (
      <div className="pk">
        <div className="ws-empty">
          <h2>Noch kein Startgerüst</h2>
          <p>
            {campaign.state === "vorbereitung"
              ? "Die Maschine zerlegt Ihre Begründung gerade in einzelne Aussagen. Das dauert eine Minute; die Seite aktualisiert sich von selbst."
              : "Sobald Sie die Vorbereitung starten, zerlegt die Maschine Ihre Begründung in einzelne Aussagen."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="pk">
      <div className="pk-intro">
        <p className="cp-lead">
          So steht die Begründung der Gemeinde gerade da: vier Schritte, darunter jeweils, was ihn stützt und was ihn angreift. Gestrichelt
          gerahmte Aussagen sind Vorschläge, über die die Redaktion noch entscheidet.
        </p>
        <p className="small muted num">
          {open.released} freigegeben · {drafts} in der Redaktion
        </p>
        {canEdit && staff.role === "initiator" && open.skeletonReleased === 0 && !open.rootReleased ? (
          <form action={reproposeSkeleton.bind(null, id)} className="pk-repropose">
            <button type="submit" className="btn btn-quiet btn-small">
              Startgerüst neu vorschlagen lassen
            </button>
            <span className="small muted">Nach einer Änderung der Begründung. Geht nur, solange nichts davon freigegeben ist.</span>
          </form>
        ) : null}
        {sp.fehler && !sp.bearbeiten ? <p className="notice">{sp.fehler}</p> : null}
      </div>

      <section className="pk-root">
        <p className="pk-who">Die Maßnahme</p>
        <p className="pk-measure serif">{campaign.measure}</p>
        {root ? <ul className="pt-list">{row(root)}</ul> : null}
      </section>

      {STEPS.map((s, i) => {
        const inStep = nodes.filter((n) => n.schritt === s.key);
        const premises = inStep.filter((n) => n.rolle === "praemisse");
        const support = inStep.filter((n) => n.rolle === "beitrag" && n.richtung === "stuetzt");
        const attacks = inStep.filter((n) => n.rolle === "beitrag" && n.richtung === "greift_an");
        const questions = QUESTIONS.filter((q) => (q.steps as readonly string[]).includes(s.key));
        // Attacks under a question that does not fit the step (editors can fix them via "Bearbeiten").
        const stray = attacks.filter((n) => !questions.some((q) => q.key === n.frage));
        return (
          <section key={s.key} className="pk-step">
            <h2>
              <span className="step-no">{i + 1}</span>
              {s.label}
            </h2>
            {campaign.steps[s.key] ? (
              <p className="rd-these">
                <span>Die Gemeinde sagt</span> {campaign.steps[s.key]}
              </p>
            ) : null}

            <h3>Die Aussagen der Gemeinde</h3>
            {premises.length ? <ul className="pt-list">{premises.map(row)}</ul> : <p className="small muted">Keine.</p>}

            <h3>
              Stützt den Schritt <span className="num muted">{support.length}</span>
            </h3>
            {support.length ? <ul className="pt-list">{support.map(row)}</ul> : <p className="small muted">Noch kein Beitrag stützt diesen Schritt ausdrücklich.</p>}

            <h3>
              Greift ihn an <span className="num muted">{attacks.length}</span>
            </h3>
            {questions.map((q) => {
              const here = attacks.filter((n) => n.frage === q.key);
              // A contribution contradicting the town's own claim raises that claim's question too.
              const contradicted = premises.filter((n) => n.frage === q.key && n.disagree > 0);
              return (
                <div key={q.key} className="pk-q">
                  <p className="pk-q-h">Prüffrage: {q.label}</p>
                  {contradicted.map((n) => (
                    <p key={n.id} className="pk-contra small">
                      {n.disagree} {n.disagree === 1 ? "Beitrag widerspricht" : "Beiträge widersprechen"} der Aussage der Gemeinde „{n.text}“
                    </p>
                  ))}
                  {here.length ? (
                    <ul className="pt-list">{here.map(row)}</ul>
                  ) : !contradicted.length ? (
                    <p className="gap">Diese Prüffrage hat noch niemand gestellt.</p>
                  ) : null}
                </div>
              );
            })}
            {stray.length ? <ul className="pt-list">{stray.map(row)}</ul> : null}
          </section>
        );
      })}
    </div>
  );
}
