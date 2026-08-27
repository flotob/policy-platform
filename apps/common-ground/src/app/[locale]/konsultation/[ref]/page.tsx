import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { loadConsultation } from "@/lib/data";
import { Chain } from "@/components/Chain";
import { Measures } from "@/components/Measures";

export const dynamic = "force-dynamic";

const CQ_KINDS = [
  "empirics",
  "alternatives",
  "goal_conflict",
  "feasibility",
  "value_conflict",
] as const;

export default async function ConsultationPage({
  params,
}: {
  params: Promise<{ locale: string; ref: string }>;
}) {
  const { locale, ref } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Consultation");
  const td = await getTranslations("Doors");
  const ta = await getTranslations("AuthorTypes");

  const c = await loadConsultation(decodeURIComponent(ref));
  if (!c) notFound();

  const camps = c.camps.map(({ group, name }) => ({ group, name }));
  const trunk = c.points.filter((p) => p.measure === "übergreifend");

  const fmt = new Intl.NumberFormat(locale);
  const doorStats = CQ_KINDS.map((cq) => {
    const objections = c.points.filter((p) => p.cq === cq);
    const solutions = c.points.filter((p) => p.answersCq?.[0] === cq);
    return {
      cq,
      objections: objections.length,
      solutions: solutions.length,
      exampleObjection: objections[0]?.label ?? null,
      exampleSolution: solutions[0]?.label ?? null,
    };
  }).filter((d) => d.objections > 0 || d.solutions > 0);

  return (
    <main className="page">
      <section className="hero hero--consultation">
        <p className="hero__kicker">
          {t("kicker")} {c.ref}
        </p>
        <h1 className="hero__title">{c.title}</h1>
        <p className="hero__stats">
          {t("statLine", {
            submissions: fmt.format(c.stats.submissions),
            participants: fmt.format(c.stats.participants),
            points: fmt.format(c.stats.points),
            votes: fmt.format(c.stats.votes),
          })}
        </p>
        {c.stats.inferredVotes > 0 && (
          <p className="hero__note">
            {t("inferredNote", {
              inferred: fmt.format(c.stats.inferredVotes),
              votes: fmt.format(c.stats.votes),
            })}
          </p>
        )}
      </section>

      <section className="section">
        <h2 className="section__title">{t("campsHeading")}</h2>
        <div className="camps">
          {c.camps.slice(0, 2).map((camp, i) => (
            <div key={camp.group} className={`camp camp--${i === 0 ? "a" : "b"}`}>
              <h3 className="camp__name">{camp.name}</h3>
              <p className="camp__size">
                {t("campSize", { n: fmt.format(camp.size) })}
                {camp.topTypes.length > 0 && (
                  <>
                    {" · "}
                    {t("campTypes", {
                      types: camp.topTypes
                        .map((x) => ta(x.type as "expert"))
                        .join(", "),
                    })}
                  </>
                )}
              </p>
              {camp.summary && <p className="camp__summary">{camp.summary}</p>}
            </div>
          ))}
        </div>
      </section>

      <section className="section section--breakout">
        <h2 className="section__title">{t("chainHeading")}</h2>
        <p className="section__intro">{t("chainIntro")}</p>
        <h3 className="section__sub">{t("trunkTitle")}</h3>
        <Chain points={trunk} camps={camps} />
      </section>

      {c.measures.length > 0 && (
        <section className="section section--breakout">
          <h2 className="section__title">{t("measuresHeading")}</h2>
          <p className="section__intro">{t("measuresIntro")}</p>
          <Measures measures={c.measures} points={c.points} camps={camps} />
        </section>
      )}

      <section className="section">
        <h2 className="section__title">{t("doorsHeading")}</h2>
        <p className="section__intro">{t("doorsIntro")}</p>
        <div className="doors">
          {doorStats.map((d) => (
            <div key={d.cq} className="doorcard">
              <h3 className="doorcard__title">{td(d.cq as "empirics")}</h3>
              <p className="doorcard__q">{td(`${d.cq}Q` as "empiricsQ")}</p>
              <p className="doorcard__counts">
                {t("doorObjections", { n: d.objections })} ·{" "}
                {t("doorSolutions", { n: d.solutions })}
              </p>
              {d.exampleObjection && (
                <p className="doorcard__example">
                  <span>{t("doorExample")}</span> {d.exampleObjection}
                </p>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <h2 className="section__title">{t("methodHeading")}</h2>
        <ol className="method">
          {([1, 2, 3, 4, 5] as const).map((n) => (
            <li key={n}>{t(`methodStep${n}`)}</li>
          ))}
        </ol>
      </section>
    </main>
  );
}
