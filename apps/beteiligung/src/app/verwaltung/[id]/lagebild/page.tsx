import Link from "next/link";
import { notFound } from "next/navigation";

import { AutoRefresh } from "@/components/AutoRefresh";
import { getCampaign } from "@/lib/campaigns";
import { camps, gaps, participationStats, saturation, thinStatements } from "@/lib/lagebild";
import { requireStaff } from "@/lib/session";

import "../redaktion.css";
import "./lagebild.css";

export const metadata = { title: "Lagebild" };

const n = (x: number) => x.toLocaleString("de-DE");
const CAMP = ["A", "B", "C", "D", "E"];

/**
 * The live picture for the town (B11, B12, W2/W3): participation, the camps
 * once there are enough voters, saturation, statements short of votes, and
 * the critical questions nobody has asked. Re-reads itself while open.
 */
export default async function Lagebild({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  const { id } = await params;
  const c = await getCampaign(staff.tenant.id, id);
  if (!c) notFound();
  const [p, sat, thin, open, cs] = await Promise.all([participationStats(c), saturation(c), thinStatements(c), gaps(c), camps(c)]);
  const bridges = cs.ready ? cs.statements.filter((s) => s.bridge).sort((a, b) => Math.min(...(b.pa as number[])) - Math.min(...(a.pa as number[]))).slice(0, 5) : [];
  const conflicts = cs.ready ? cs.statements.filter((s) => !s.bridge).sort((a, b) => b.gap - a.gap).slice(0, 5) : [];

  return (
    <div className="lb">
      <AutoRefresh active={c.state === "offen"} everyMs={20000} />

      <section className="lb-sec">
        <h2>Beteiligung</h2>
        <dl className="lb-nums">
          <div>
            <dt>Abstimmende</dt>
            <dd className="num">{n(p.voters)}</dd>
          </div>
          <div>
            <dt>Stimmen</dt>
            <dd className="num">{n(p.realVotes)}</dd>
          </div>
          <div>
            <dt>Aussagen zur Abstimmung</dt>
            <dd className="num">{n(p.statements)}</dd>
          </div>
          <div>
            <dt>Eigene Punkte (Tür 2)</dt>
            <dd className="num">{n(p.shortPoints)}</dd>
          </div>
          <div>
            <dt>Stellungnahmen (Tür 3)</dt>
            <dd className="num">{n(p.uploads)}</dd>
          </div>
        </dl>
        <p className="small muted lb-note">
          Dazu {n(p.derivedVotes)} Stimmen, die aus Stellungnahmen und bestätigten eigenen Punkten folgen: Wer einen Punkt vertritt, stimmt ihm zu.
          {p.shortConfirmed
            ? ` ${n(p.shortConfirmed)} ${p.shortConfirmed === 1 ? "eigener Punkt stand" : "eigene Punkte standen"} schon zur Abstimmung; die Verfasser haben das bestätigt.`
            : ""}
          {p.simulated ? ` Achtung: ${n(p.simulated)} Teilnehmende sind simuliert (Testdaten).` : ""}
        </p>
      </section>

      <section className="lb-sec">
        <h2>Lager</h2>
        {!cs.ready ? (
          <p className="lb-wait">
            Lager rechnet die Maschine, sobald mindestens {n(cs.needed)} Menschen genug Aussagen bewertet haben. Bisher: {n(cs.clusterable)}.
          </p>
        ) : (
          <>
            <p className="lb-lead">
              Die Abstimmenden teilen sich in {cs.k} Lager:{" "}
              {cs.sizes.map((size, g) => (
                <span key={g} className={`camp camp-${CAMP[g]}`}>
                  Lager {CAMP[g]} <span className="num">{n(size)}</span>
                </span>
              ))}
              <span className="small muted">
                {" "}
                {cs.silhouette >= 0.5 ? "Deutlich getrennt." : cs.silhouette >= 0.25 ? "Erkennbar getrennt." : "Nur schwach getrennt; mit Vorsicht lesen."}
              </span>
            </p>
            <div className="lb-two">
              <div>
                <h3>Darauf einigen sich alle Lager</h3>
                {bridges.length ? (
                  <ul className="lb-list">
                    {bridges.map((s) => (
                      <li key={s.id}>
                        <p>{s.text}</p>
                        <Profile pa={s.pa} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="small muted">Noch keine Aussage, der alle Lager mehrheitlich zustimmen.</p>
                )}
              </div>
              <div>
                <h3>Hier liegt der Streit</h3>
                <ul className="lb-list">
                  {conflicts.map((s) => (
                    <li key={s.id}>
                      <p>{s.text}</p>
                      <Profile pa={s.pa} />
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </>
        )}
      </section>

      <section className="lb-sec">
        <h2>Kommt noch Neues?</h2>
        {sat.inputs ? (
          <>
            <p className="lb-lead">
              {sat.saturated
                ? `Gesättigt: Seit ${n(sat.streak)} Eingaben ist kein neuer Punkt mehr dazugekommen.`
                : sat.streak
                  ? `Seit ${n(sat.streak)} ${sat.streak === 1 ? "Eingabe" : "Eingaben"} kein neuer Punkt. Als gesättigt gilt die Beteiligung nach ${n(sat.window)} Eingaben ohne neuen Punkt.`
                  : "Die letzte Eingabe hat einen neuen Punkt gebracht."}
            </p>
            <div className="lb-strip" aria-label={`${sat.inputs} Eingaben, ${sat.newPoints} davon mit neuem Punkt`}>
              {sat.series.map((isNew, i) => (
                <i key={i} className={isNew ? "new" : undefined} />
              ))}
            </div>
            <p className="small muted">
              Jedes Kästchen ist eine Eingabe (eigener Punkt oder Stellungnahme), gefüllt, wenn sie einen neuen Punkt gebracht hat. {n(sat.inputs)} Eingaben,{" "}
              {n(sat.newPoints)} mit neuem Punkt{sat.open ? `, ${n(sat.open)} noch in der Redaktion` : ""}.
            </p>
          </>
        ) : (
          <p className="small muted">Noch keine Eingaben.</p>
        )}
      </section>

      <div className="lb-two">
        <section className="lb-sec">
          <h2>Brauchen mehr Stimmen</h2>
          <p className="small muted">Neue und wenig bewertete Aussagen zeigt die Abstimmung zuerst. Die Hälfte der Aussagen hat mehr als {n(thin.median)} Stimmen.</p>
          <ul className="lb-list">
            {thin.thin.map((s) => (
              <li key={s.id}>
                <p>{s.text}</p>
                <span className="small muted num">
                  {n(s.votes)} {s.votes === 1 ? "Stimme" : "Stimmen"}
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section className="lb-sec">
          <h2>Prüffragen, die niemand gestellt hat</h2>
          {open.length ? (
            <ul className="lb-gaps">
              {open.map((g) => (
                <li key={`${g.step}|${g.question}`}>
                  <span className="small muted">{g.step}</span>
                  {g.question}
                </li>
              ))}
            </ul>
          ) : (
            <p className="small muted">Jede Prüffrage ist mindestens einmal gestellt worden.</p>
          )}
          <p className="small">
            <Link href={`/verwaltung/${id}/punkte`}>Begründung und Einwände ansehen</Link>
          </p>
        </section>
      </div>
    </div>
  );
}

/** Agreement per camp as one row of bars, camp colours from the results page. */
function Profile({ pa }: { pa: (number | null)[] }) {
  return (
    <span className="profile">
      {pa.map((x, g) => (
        <span key={g} className={`profile-row camp-${CAMP[g]}`}>
          <span className="profile-l">{CAMP[g]}</span>
          <span className="profile-bar">
            <i style={{ width: `${x ?? 0}%` }} />
          </span>
          <span className="num small">{x === null ? "–" : `${x} %`}</span>
        </span>
      ))}
    </span>
  );
}
