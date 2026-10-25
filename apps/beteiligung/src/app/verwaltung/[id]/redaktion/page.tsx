import { textSimilarity } from "@policy/pipeline/kern";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Quote } from "@/components/Quote";
import { getCampaign } from "@/lib/campaigns";
import { EDITORIAL_MODES, QUESTIONS, STEPS, type EditorialMode } from "@/lib/params";
import { getMove, getNode, listNodes, loadQueue, movesOfNode, queueSize, type Move, type Node } from "@/lib/redaktion";
import { requireStaff } from "@/lib/session";
import { actorName, certainty, FLAG, REJECT, TYP } from "@/lib/vocab";

import {
  confirmMoveAction,
  detachMoveAction,
  discardMoveAction,
  mergeNodeAction,
  newNodeFromMoveAction,
  reassignMoveAction,
  rejectNodeAction,
  releaseNodeAction,
} from "./actions";
import { NodeEditor } from "./NodeEditor";
import "../redaktion.css";

export const metadata = { title: "Redaktion" };

const stepLabel = (k: string | null) => {
  const i = STEPS.findIndex((s) => s.key === k);
  return i < 0 ? "" : `Schritt ${i + 1}: ${STEPS[i]!.label}`;
};
const questionLabel = (k: string | null) => QUESTIONS.find((q) => q.key === k)?.label ?? "";
const short = (t: string, n = 110) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);

function kindOf(n: Node): string {
  if (n.rolle === "schluss") return "Startgerüst · Die Maßnahme selbst";
  if (n.rolle === "praemisse") return `Startgerüst · ${stepLabel(n.schritt)}`;
  return "Neuer Punkt";
}

/** The machine's recommendation in the words of the mode: a hint, a default, or why it stayed with a person. */
function Recommendation({ node, mode }: { node: Node; mode: EditorialMode }) {
  const r = node.review;
  if (!r) return null;
  const flags = r.flags.map((f) => FLAG[f as keyof typeof FLAG] ?? f);
  if (mode === "mensch") {
    if (!flags.length) return null;
    return (
      <div className="rec">
        <p className="rec-h">Hinweise der Maschine</p>
        <ul>
          {flags.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      </div>
    );
  }
  const verdict = { release: "Freigeben", reject: "Verwerfen", review: "Bitte prüfen" }[r.verdict];
  return (
    <div className={`rec rec-${r.verdict}`}>
      <p className="rec-h">
        Vorschlag der Maschine: <strong>{verdict}</strong>
      </p>
      {mode === "ki" && node.rolle !== "beitrag" ? (
        <p className="small">Das Startgerüst gibt immer ein Mensch frei: Es spricht im Namen der Gemeinde.</p>
      ) : mode === "ki" ? (
        <p className="small">Die Maschine hat diesen Punkt nicht allein entschieden.</p>
      ) : null}
      {flags.length ? (
        <ul>
          {flags.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Similar points to compare before releasing: what the matcher saw, plus the closest wording. */
function similarTo(node: Node, moves: Move[], all: Node[]): { node: Node; opposite: boolean }[] {
  // What the matcher compared each move with (closest first), then the closest wording.
  const hinted = new Map<string, boolean>();
  for (const m of moves) {
    for (const c of m.match?.candidates ?? []) {
      const close = c.pSame + c.pOpposite >= 0.15 || c.pRelated >= 0.5;
      if (c.node !== node.id && close) hinted.set(c.node, hinted.get(c.node) || c.pOpposite >= 0.5);
    }
  }
  const others = all.filter((n) => n.id !== node.id);
  const lexical = others
    .map((n) => ({ n, s: textSimilarity(node.text, n.text) }))
    .filter((x) => x.s >= 0.3)
    .sort((a, b) => b.s - a.s)
    .slice(0, 3)
    .map((x) => x.n.id);
  const ids = [...hinted.keys(), ...lexical.filter((id) => !hinted.has(id))].slice(0, 5);
  return ids.map((id) => ({ node: others.find((n) => n.id === id)!, opposite: hinted.get(id) ?? false })).filter((x) => x.node);
}

function NodeTargets({ all, exclude }: { all: Node[]; exclude?: string }) {
  return (
    <>
      {all
        .filter((n) => n.id !== exclude)
        .map((n) => (
          <option key={n.id} value={n.id}>
            {n.status === "draft" ? "(Vorschlag) " : ""}
            {short(n.text, 90)}
          </option>
        ))}
    </>
  );
}

export default async function Redaktion({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ punkt?: string; beitrag?: string; fehler?: string }>;
}) {
  const staff = await requireStaff();
  const { id } = await params;
  const sp = await searchParams;
  const campaign = await getCampaign(staff.tenant.id, id);
  if (!campaign) notFound();
  const canDecide = staff.role !== "betrachter";
  const mode = campaign.params.editorialMode;
  const [queue, all] = await Promise.all([loadQueue(campaign.consultationId), listNodes(campaign.consultationId)]);
  const total = queueSize(queue);

  let node: Node | null = null;
  let move: Move | null = null;
  if (sp.punkt) node = await getNode(campaign.consultationId, sp.punkt);
  else if (sp.beitrag) move = await getMove(campaign.consultationId, sp.beitrag);
  else if (queue.skeleton[0] ?? queue.proposals[0]) node = (queue.skeleton[0] ?? queue.proposals[0])!;
  else move = queue.uncertain[0] ?? queue.samples[0] ?? null;
  const moves = node ? await movesOfNode(node.id) : [];
  const assigned = move?.nodeId ? all.find((n) => n.id === move!.nodeId) : null;
  const isSample = !!move && move.sample && move.state !== "vorgelegt";
  const these = node?.schritt ? campaign.steps[node.schritt] : null;
  const base = `/verwaltung/${id}/redaktion`;

  const rows: { title: string; items: { href: string; current: boolean; title: string; meta: string; mark?: string }[] }[] = [
    {
      title: "Startgerüst",
      items: queue.skeleton.map((n) => ({
        href: `${base}?punkt=${n.id}`,
        current: node?.id === n.id,
        title: n.label,
        meta: n.rolle === "schluss" ? "Die Maßnahme selbst" : `${stepLabel(n.schritt).replace(/:.*/, "")} · ${TYP[n.typ].label}`,
        mark: mode !== "mensch" ? n.review?.verdict : undefined,
      })),
    },
    {
      title: "Neue Punkte",
      items: queue.proposals.map((n) => ({
        href: `${base}?punkt=${n.id}`,
        current: node?.id === n.id,
        title: n.label,
        meta: `${n.senders.length} ${n.senders.length === 1 ? "Absender" : "Absender"}${n.disagree ? ` · ${n.disagree} widerspricht` : ""}`,
        mark: mode !== "mensch" ? n.review?.verdict : undefined,
      })),
    },
    {
      title: "Unsichere Zuordnungen",
      items: queue.uncertain.map((m) => ({
        href: `${base}?beitrag=${m.id}`,
        current: move?.id === m.id,
        title: m.sender,
        meta: m.decision?.einspruch ? "Einspruch des Verfassers" : m.route === "gegenteil" ? "Gegenteil eines Punkts?" : "Gleicher Punkt?",
      })),
    },
    {
      title: "Stichproben",
      items: queue.samples.map((m) => ({
        href: `${base}?beitrag=${m.id}`,
        current: move?.id === m.id,
        title: m.sender,
        meta: m.decidedBy === "regel" ? "automatisch zugeordnet" : "von der Maschine entschieden",
      })),
    },
  ];

  return (
    <div className="rd">
      <p className="rd-mode small">
        <strong>{EDITORIAL_MODES[mode].label}.</strong> <span className="muted">{EDITORIAL_MODES[mode].text}</span>{" "}
        {staff.role === "initiator" ? <Link href={`/verwaltung/${id}#ablauf`}>Arbeitsweise ändern</Link> : null}
      </p>
      {["auswertung", "bericht", "veroeffentlicht"].includes(campaign.state) ? (
        <p className="notice small">
          Die Beteiligung ist geschlossen. Was Sie jetzt noch freigeben, kommt nicht mehr zur Abstimmung und nicht ins gespeicherte Ergebnis.
        </p>
      ) : null}

      <div className="rd-grid">
        <aside className={`rd-list${node || move ? " has-current" : ""}`} aria-label="Warteschlange">
          {total === 0 ? (
            <p className="muted small rd-empty">
              Nichts zu entscheiden. Neue Beiträge erscheinen hier, sobald die Maschine sie gelesen hat.
            </p>
          ) : (
            rows
              .filter((r) => r.items.length)
              .map((r) => (
                <section key={r.title}>
                  <h2>
                    {r.title} <span className="num muted">{r.items.length}</span>
                  </h2>
                  <ol>
                    {r.items.map((it) => (
                      <li key={it.href}>
                        <Link href={it.href} aria-current={it.current ? "true" : undefined}>
                          <span className="rd-li-t">{it.title}</span>
                          <span className="rd-li-m">
                            {it.mark ? <i className={`mark mark-${it.mark}`} title={{ release: "Vorschlag: freigeben", reject: "Vorschlag: verwerfen", review: "Bitte prüfen" }[it.mark]} /> : null}
                            {it.meta}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ol>
                </section>
              ))
          )}
        </aside>

        <section className="rd-detail" aria-live="polite">
          {sp.fehler ? <p className="notice rd-error">{sp.fehler}</p> : null}

          {node ? (
            node.status !== "draft" ? (
              <div className="rd-done">
                <p>
                  Über diesen Punkt ist entschieden: <strong>{{ released: "freigegeben", rejected: "verworfen", merged: "zusammengeführt", draft: "" }[node.status]}</strong>
                  {node.releasedBy ? ` ${actorName(node.releasedBy)}` : ""}.
                </p>
                <p>
                  <Link href={base} className="btn btn-quiet btn-small">
                    Zum nächsten Punkt
                  </Link>
                </p>
              </div>
            ) : (
              <article className="rd-card">
                <p className="rd-kind">{kindOf(node)}</p>
                {these ? (
                  <p className="rd-these">
                    <span>Die Gemeinde sagt</span> {these}
                  </p>
                ) : null}
                <Recommendation node={node} mode={mode} />
                {canDecide ? (
                  <NodeEditor
                    key={node.id}
                    node={node}
                    action={releaseNodeAction.bind(null, id, node.id)}
                    submitLabel={mode !== "mensch" && node.review?.verdict === "release" ? "Vorschlag übernehmen: freigeben" : "Freigeben"}
                    hint={moves.length ? `Mit der Freigabe ${moves.length === 1 ? "gehört der Beitrag" : `gehören die ${moves.length} Beiträge`} unten zu diesem Punkt.` : undefined}
                  />
                ) : (
                  <p className="rd-text serif">{node.text}</p>
                )}

                {moves.length ? (
                  <section className="rd-sec">
                    <h3>Aus den Stellungnahmen</h3>
                    {moves.map((m) => (
                      <Quote
                        key={m.id}
                        move={m}
                        note={
                          m.route === "unsicher" || m.route === "gegenteil" ? (
                            <span className="warn-text">
                              Von der Maschine zugeordnet, {m.route === "gegenteil" ? "als Widerspruch" : "als gleicher Punkt"}; sie ist{" "}
                              {certainty(m.route === "gegenteil" ? (m.match?.pOpposite ?? 0) : (m.match?.pSame ?? 0))}.
                            </span>
                          ) : null
                        }
                      >
                        {canDecide && (moves.length > 1 || m.route === "unsicher" || m.route === "gegenteil") ? (
                          <>
                            <form action={detachMoveAction.bind(null, id, node.id, m.id)}>
                              <button type="submit" className="btn btn-quiet btn-small">
                                Als eigenen Punkt herauslösen
                              </button>
                            </form>
                            <form action={discardMoveAction.bind(null, id, `punkt=${node.id}`, m.id)}>
                              <input type="hidden" name="reason" value="kein_argument" />
                              <button type="submit" className="btn btn-quiet btn-small">
                                Kein Argument
                              </button>
                            </form>
                            <details className="quote-move">
                              <summary className="btn btn-quiet btn-small">Anderem Punkt zuordnen</summary>
                              <form action={reassignMoveAction.bind(null, id, `punkt=${node.id}`, m.id)} className="rd-reassign">
                                <select name="node" className="select" aria-label="Punkt" defaultValue="">
                                  <option value="" disabled>
                                    Punkt wählen …
                                  </option>
                                  <NodeTargets all={all} exclude={node.id} />
                                </select>
                                <div className="seg">
                                  <label>
                                    <input type="radio" name="stance" value="1" defaultChecked />
                                    <span>stimmt zu</span>
                                  </label>
                                  <label>
                                    <input type="radio" name="stance" value="-1" />
                                    <span>widerspricht</span>
                                  </label>
                                </div>
                                <button type="submit" className="btn btn-quiet btn-small">
                                  Zuordnen
                                </button>
                              </form>
                            </details>
                          </>
                        ) : null}
                      </Quote>
                    ))}
                  </section>
                ) : node.rolle !== "beitrag" ? (
                  <p className="small muted rd-sec">Aus der Begründung der Gemeinde. Noch kein Beitrag bezieht sich darauf.</p>
                ) : null}

                {canDecide && node.rolle === "beitrag" ? (
                  <section className="rd-sec">
                    <h3>Steht das schon da?</h3>
                    {(() => {
                      const sim = similarTo(node, moves, all);
                      return sim.length ? (
                        <ul className="rd-sim">
                          {sim.map(({ node: s, opposite }) => (
                            <li key={s.id}>
                              <p>
                                {s.text} <span className="tag">{s.status === "released" ? "freigegeben" : "Vorschlag"}</span>
                              </p>
                              {opposite ? <p className="small warn-text">Die Maschine hält das für das Gegenteil dieses Punkts.</p> : null}
                              <div className="rd-sim-actions">
                                <form action={mergeNodeAction.bind(null, id, node.id, s.id, 1)}>
                                  <button type="submit" className="btn btn-quiet btn-small">
                                    Gleiche Aussage: zusammenführen
                                  </button>
                                </form>
                                <form action={mergeNodeAction.bind(null, id, node.id, s.id, -1)}>
                                  <button type="submit" className={`btn btn-small ${opposite ? "" : "btn-quiet"}`}>
                                    Gegenteil: als Widerspruch zusammenführen
                                  </button>
                                </form>
                              </div>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="small muted">Kein ähnlicher Punkt gefunden. Das spricht für einen neuen Punkt.</p>
                      );
                    })()}
                  </section>
                ) : null}

                {canDecide && node.rolle !== "schluss" ? (
                  <details className="rd-sec rd-reject" open={mode !== "mensch" && node.review?.verdict === "reject"}>
                    <summary>Verwerfen</summary>
                    <form action={rejectNodeAction.bind(null, id, node.id)} className="rd-reject-form">
                      <select name="reason" className="select" aria-label="Grund">
                        {(Object.keys(REJECT) as (keyof typeof REJECT)[]).map((k) => (
                          <option key={k} value={k}>
                            {REJECT[k]}
                          </option>
                        ))}
                      </select>
                      <button type="submit" className="btn btn-quiet">
                        {mode !== "mensch" && node.review?.verdict === "reject" ? "Vorschlag übernehmen: verwerfen" : "Verwerfen"}
                      </button>
                    </form>
                    <p className="small muted">Verworfene Beiträge bleiben im Protokoll, kommen aber nicht in die Abstimmung.</p>
                  </details>
                ) : null}
              </article>
            )
          ) : move ? (
            <article className="rd-card">
              <p className="rd-kind">
                {isSample
                  ? `Stichprobe · ${move.decidedBy === "regel" ? "automatisch zugeordnet" : actorName(move.decidedBy)}`
                  : move.decision?.einspruch
                    ? "Einspruch · Der Verfasser sagt: „Das meint mein Punkt nicht.“"
                    : move.route === "gegenteil"
                    ? "Unsichere Zuordnung · Gegenteil eines Punkts?"
                    : "Unsichere Zuordnung · Gleicher Punkt?"}
              </p>
              <Quote move={move} />
              {move.state === "verworfen" ? (
                <p className="rd-assign">Die Maschine hat diesen Beitrag verworfen: kein Sachargument.</p>
              ) : assigned ? (
                <div className="rd-assign">
                  <p className="small muted">
                    {move.decision?.einspruch
                      ? "Bisher gehört er zu diesem Punkt. Der Verfasser sagt, das meine er nicht:"
                      : move.stance === -1
                        ? "Die Maschine ordnet ihn als Widerspruch zu diesem Punkt:"
                        : "Die Maschine ordnet ihn diesem Punkt zu:"}
                  </p>
                  <p className="rd-text serif">{assigned.text}</p>
                  <p className="small muted">
                    {stepLabel(assigned.schritt)}
                    {assigned.frage ? ` · ${questionLabel(assigned.frage)}` : ""}
                    {move.decision?.einspruch
                      ? ""
                      : ` · die Maschine ist ${certainty(move.stance === -1 ? (move.match?.pOpposite ?? 0) : (move.match?.pSame ?? 0))}`}
                  </p>
                </div>
              ) : null}
              {canDecide ? (
                <>
                  <div className="form-foot">
                    <form action={confirmMoveAction.bind(null, id, move.id)}>
                      <button type="submit" className="btn">
                        {isSample ? "Passt" : "Bestätigen"}
                      </button>
                    </form>
                    <form action={newNodeFromMoveAction.bind(null, id, move.id)}>
                      <button type="submit" className="btn btn-quiet">
                        Als eigenen Punkt vorschlagen
                      </button>
                    </form>
                  </div>
                  <details className="rd-sec">
                    <summary>Einem anderen Punkt zuordnen</summary>
                    <form action={reassignMoveAction.bind(null, id, `beitrag=${move.id}`, move.id)} className="rd-reassign">
                      <select name="node" className="select" aria-label="Punkt" defaultValue="">
                        <option value="" disabled>
                          Punkt wählen …
                        </option>
                        <NodeTargets all={all} exclude={move.nodeId ?? undefined} />
                      </select>
                      <div className="seg">
                        <label>
                          <input type="radio" name="stance" value="1" defaultChecked />
                          <span>stimmt zu</span>
                        </label>
                        <label>
                          <input type="radio" name="stance" value="-1" />
                          <span>widerspricht</span>
                        </label>
                      </div>
                      <button type="submit" className="btn btn-quiet">
                        Zuordnen
                      </button>
                    </form>
                  </details>
                  {move.state !== "verworfen" ? (
                    <details className="rd-sec rd-reject">
                      <summary>Verwerfen</summary>
                      <form action={discardMoveAction.bind(null, id, `beitrag=${move.id}`, move.id)} className="rd-reject-form">
                        <select name="reason" className="select" aria-label="Grund">
                          {(Object.keys(REJECT) as (keyof typeof REJECT)[]).map((k) => (
                            <option key={k} value={k}>
                              {REJECT[k]}
                            </option>
                          ))}
                        </select>
                        <button type="submit" className="btn btn-quiet">
                          Verwerfen
                        </button>
                      </form>
                    </details>
                  ) : null}
                </>
              ) : null}
            </article>
          ) : (
            <div className="rd-done">
              <p className="serif rd-done-h">Die Warteschlange ist leer.</p>
              <p className="muted">
                Alles, was die Maschine vorgelegt hat, ist entschieden. Unter{" "}
                <Link href={`/verwaltung/${id}/punkte`}>Begründung und Einwände</Link> sehen Sie, wie die Begründung jetzt dasteht.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
