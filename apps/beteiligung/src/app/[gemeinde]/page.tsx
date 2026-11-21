import { sql } from "@policy/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { PublicFrame } from "@/components/PublicFrame";
import { participation } from "@/lib/abstimmung";
import { confirmedTown } from "@/lib/bestaetigen";
import { publicDecision } from "@/lib/beschluss";
import { decisionHead } from "@/lib/beschluss-words";
import { maySeePreview, publicCampaignsOf, type Campaign } from "@/lib/campaigns";
import { getDb } from "@/lib/db";
import { kommuneBySlug, type KommuneLink } from "@/lib/kommune";
import { RESERVED } from "@/lib/slug";

import "./public.css";

const day = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long", year: "numeric" });
const n = (x: number) => x.toLocaleString("de-DE");

export async function generateMetadata({ params }: { params: Promise<{ gemeinde: string }> }) {
  const { gemeinde } = await params;
  const k = RESERVED.has(gemeinde) ? null : await kommuneBySlug(gemeinde);
  return k ? { title: k.name, description: k.settings.claim || `Beteiligungen der ${k.name}` } : { title: "Nicht gefunden" };
}

/** The first paragraph of a procedure's summary, cut at a sentence end near `max` characters. */
function teaser(text: string | null, max = 260): string {
  const first = (text ?? "").split(/\r?\n\s*\r?\n/)[0]!.trim();
  if (first.length <= max) return first;
  const cut = first.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return end > 80 ? cut.slice(0, end + 1) : `${cut.replace(/\s+\S*$/, "")} …`;
}

const ICON: Record<string, ReactNode> = {
  web: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" />
    </>
  ),
  news: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M8 9h8M8 13h8M8 17h5" />
    </>
  ),
  instagram: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="5" />
      <circle cx="12" cy="12" r="3.6" />
      <circle cx="16.8" cy="7.2" r="0.6" fill="currentColor" />
    </>
  ),
  video: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="3" />
      <path d="M10.5 9.5v5l4-2.5z" fill="currentColor" />
    </>
  ),
  social: <path d="M5 5h14v10H10l-4 4v-4H5z" />,
  link: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
};

/** Which sign a link gets: known sites by address, the town's paper by name, else a plain link. */
function iconOf(l: KommuneLink): string {
  let host = "";
  let path = "";
  try {
    const u = new URL(l.url);
    host = u.hostname.replace(/^www\./, "");
    path = u.pathname;
  } catch {
    /* stored links are checked on save */
  }
  if (/(^|\.)instagram\.com$/.test(host)) return "instagram";
  if (/(^|\.)(youtube\.com|youtu\.be)$/.test(host)) return "video";
  if (path.startsWith("/@") || /(^|\.)(facebook\.com|linkedin\.com|bsky\.app|threads\.net)$/.test(host)) return "social";
  if (/amtsblatt|zeitung|nachrichten|news|presse/i.test(l.label)) return "news";
  return "link";
}

function Icon({ name }: { name: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {ICON[name] ?? ICON.link}
    </svg>
  );
}

type Item = Campaign & { stats?: { statements: number }; decision?: Awaited<ReturnType<typeof publicDecision>> };

/** A municipality's public page: who the town is, what is open now, what was decided. */
export default async function Gemeinde({ params }: { params: Promise<{ gemeinde: string }> }) {
  const { gemeinde } = await params;
  if (RESERVED.has(gemeinde)) notFound();
  const t = (await getDb().execute(sql`SELECT t.id, ${confirmedTown("t")} AS confirmed FROM tenants t WHERE t.slug = ${gemeinde}`)).rows[0] as
    | { id: string; confirmed: boolean }
    | undefined;
  // A town nobody has confirmed an address for is seen by its own team only (lib/bestaetigen.ts).
  const preview = t ? !t.confirmed : false;
  if (!t || (preview && !(await maySeePreview(t.id)))) notFound();
  const k = (await kommuneBySlug(gemeinde))!;
  const s = k.settings;

  const all: Item[] = await Promise.all(
    (await publicCampaignsOf(t.id)).map(async (c) => ({
      ...c,
      stats: c.state === "offen" ? await participation(c) : undefined,
      decision: c.state === "veroeffentlicht" ? await publicDecision(c.id) : undefined,
    })),
  );
  const open = all.filter((c) => c.state === "offen");
  const soon = all.filter((c) => c.state === "vorbereitung");
  const counting = all.filter((c) => c.state === "auswertung" || c.state === "bericht");
  const done = all.filter((c) => c.state === "veroeffentlicht");
  const links: { label: string; url: string; icon: string }[] = [
    ...(s.website ? [{ label: "Website", url: s.website, icon: "web" }] : []),
    ...s.links.map((l) => ({ ...l, icon: iconOf(l) })),
  ];
  const contact = s.kontakt.stelle || s.kontakt.telefon || s.kontakt.email || s.kontakt.zeiten;
  const base = `/${k.slug}`;

  return (
    <PublicFrame town={k}>
      <main className="wrap tp">
        {preview ? <p className="notice">Vorschau für Ihr Team: Öffentlich sichtbar wird diese Seite, sobald jemand aus Ihrem Team die E-Mail-Adresse bestätigt hat.</p> : null}

        {/* What the town has not uploaded is left out, not stood in for: no empty band, no letter. */}
        <section className={k.titelbild ? "tp-head tp-head-cover" : "tp-head"} aria-label={k.name}>
          {k.titelbild ? (
            <figure className="tp-cover">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={k.titelbild} alt={s.titelbild.alt} />
              {s.titelbild.credit ? <figcaption>Bild: {s.titelbild.credit}</figcaption> : null}
            </figure>
          ) : null}
          <div className="tp-id">
            <div className="tp-who">
              {k.logo ? (
                <div className="tp-logo">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={k.logo} alt={`Logo: ${k.name}`} />
                </div>
              ) : null}
              <div className="tp-name">
                <h1>{k.name}</h1>
                {s.claim ? <p>{s.claim}</p> : null}
              </div>
            </div>
            {links.length ? (
              <nav className="tp-links" aria-label={`Links: ${k.name}`}>
                {links.map((l) => (
                  <a key={l.url} href={l.url} rel="noopener noreferrer" target="_blank">
                    <Icon name={l.icon} />
                    {l.label}
                  </a>
                ))}
              </nav>
            ) : null}
          </div>
          <p className="tp-count">
            <strong>
              {all.length === 1 ? "Eine Beteiligung" : `${n(all.length)} Beteiligungen`}
            </strong>
            {open.length ? (open.length === 1 ? (all.length === 1 ? ", sie läuft gerade" : ", eine läuft gerade") : `, ${n(open.length)} laufen gerade`) : ""}
          </p>
        </section>

        <div className="tp-body">
          <div className="tp-main">
            <section aria-labelledby="tp-jetzt">
              <h2 id="tp-jetzt">Jetzt mitreden</h2>
              {open.length ? (
                open.map((c) => {
                  const end = c.params.end ? day.format(new Date(c.params.end)) : null;
                  const vote = c.params.doors.abstimmen && c.params.access === "offen";
                  return (
                    <article key={c.id} className="tp-open">
                      <p className="tp-open-when">
                        <span aria-hidden="true" />
                        {end ? `Läuft bis ${end}` : "Läuft gerade"}
                      </p>
                      <h3>
                        <Link href={`${base}/${c.slug}`}>{c.question}</Link>
                      </h3>
                      {c.summary ? <p className="tp-open-text">{teaser(c.summary)}</p> : null}
                      {c.stats?.statements ? <p className="tp-open-meta">{n(c.stats.statements)} Punkte liegen auf dem Tisch.</p> : null}
                      <div className="tp-open-actions">
                        <Link href={vote ? `${base}/${c.slug}/abstimmen` : `${base}/${c.slug}`} className="btn">
                          {vote ? "Abstimmen starten" : "Mitmachen"}
                        </Link>
                        <Link href={`${base}/${c.slug}`} className="btn btn-quiet">
                          Worum es geht
                        </Link>
                      </div>
                    </article>
                  );
                })
              ) : (
                <p className="muted tp-none">Gerade läuft keine Beteiligung.</p>
              )}
            </section>

            {soon.length ? (
              <section aria-labelledby="tp-bald">
                <h2 id="tp-bald">Demnächst</h2>
                <ul className="tp-rows">
                  {soon.map((c) => {
                    const start = c.params.start && new Date(c.params.start) > new Date() ? day.format(new Date(c.params.start)) : null;
                    return (
                      <li key={c.id}>
                        <p className="tp-row-k">{start ? `Beginnt am ${start}` : "Beginnt in Kürze"}</p>
                        <h3>
                          <Link href={`${base}/${c.slug}`}>{c.question}</Link>
                        </h3>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}

            {counting.length ? (
              <section aria-labelledby="tp-auswertung">
                <h2 id="tp-auswertung">In Auswertung</h2>
                <ul className="tp-rows">
                  {counting.map((c) => (
                    <li key={c.id}>
                      <p className="tp-row-k">Die Beteiligung ist geschlossen. Der Bericht für den Rat entsteht.</p>
                      <h3>
                        <Link href={`${base}/${c.slug}`}>{c.question}</Link>
                      </h3>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {done.length ? (
              <section aria-labelledby="tp-fertig">
                <h2 id="tp-fertig">Abgeschlossen</h2>
                <ul className="tp-rows">
                  {done.map((c) => (
                    <li key={c.id}>
                      <p className="tp-row-k">{c.decision ? decisionHead(c.decision) : "Das Ergebnis ist veröffentlicht."}</p>
                      <h3>
                        <Link href={`${base}/${c.slug}`}>{c.question}</Link>
                      </h3>
                      {c.decision?.summary ? <p className="tp-decision">{c.decision.summary}</p> : null}
                      <p className="tp-row-links">
                        <Link href={`${base}/${c.slug}/ergebnis`}>Ergebnis ansehen</Link>
                        <Link href={`${base}/${c.slug}/bericht`}>Bericht lesen</Link>
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section aria-labelledby="tp-wie" className="tp-how">
              <h2 id="tp-wie">So läuft eine Beteiligung</h2>
              <ol>
                <li>Die {/^(Stadt|Gemeinde)$/.test(k.name.split(/\s+/)[0]!) ? k.name.split(/\s+/)[0] : "Kommune"} stellt ein Vorhaben zur Diskussion und begründet es.</li>
                <li>Du stimmst über kurze Aussagen ab, bringst einen eigenen Punkt ein oder reichst eine Stellungnahme ein.</li>
                <li>
                  Der Rat bekommt einen Bericht: worüber man sich einig ist, was ein Gutachten klären kann und was er selbst entscheiden muss. Danach steht bei
                  jeder Aussage, was der Rat aus ihr gemacht hat.
                </li>
              </ol>
            </section>
          </div>

          {s.gruss.text || contact ? (
            <aside className="tp-aside" aria-label={`Über ${k.name}`}>
              {s.gruss.text ? (
                <section className="tp-card">
                  <h2>Ein Wort vorab</h2>
                  <blockquote>{s.gruss.text}</blockquote>
                  {s.gruss.name ? (
                    <div className="tp-person">
                      {k.portrait ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={k.portrait} alt="" />
                      ) : null}
                      <p>
                        <strong>{s.gruss.name}</strong>
                        {s.gruss.amt ? <span>{s.gruss.amt}</span> : null}
                      </p>
                    </div>
                  ) : null}
                </section>
              ) : null}
              {contact ? (
                <section className="tp-card">
                  <h2>Fragen zur Beteiligung</h2>
                  {s.kontakt.stelle ? <p className="tp-stelle">{s.kontakt.stelle}</p> : null}
                  <dl>
                    {s.kontakt.telefon ? (
                      <>
                        <dt>Telefon</dt>
                        <dd>
                          <a href={`tel:${s.kontakt.telefon.replace(/[^\d+]/g, "")}`}>{s.kontakt.telefon}</a>
                        </dd>
                      </>
                    ) : null}
                    {s.kontakt.email ? (
                      <>
                        <dt>E-Mail</dt>
                        <dd>
                          <a href={`mailto:${s.kontakt.email}`}>{s.kontakt.email}</a>
                        </dd>
                      </>
                    ) : null}
                    {s.kontakt.zeiten ? (
                      <>
                        <dt>Erreichbar</dt>
                        <dd>{s.kontakt.zeiten}</dd>
                      </>
                    ) : null}
                  </dl>
                  {s.kontakt.telefon || s.kontakt.stelle ? (
                    <p className="tp-offline">
                      <strong>Ohne Internet?</strong> Du kannst auch {s.kontakt.telefon ? "am Telefon, " : ""}persönlich oder per Brief mitmachen. Die Redaktion trägt
                      deinen Beitrag ein, und er zählt wie jeder andere.
                    </p>
                  ) : null}
                </section>
              ) : null}
            </aside>
          ) : null}
        </div>
      </main>
    </PublicFrame>
  );
}
