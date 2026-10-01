import type { Metadata } from "next";

import { loadVoteData } from "@policy/landkarte/data/vote";

import { VoteDeck } from "@/components/VoteDeck";
import { getDb } from "@/lib/db";
import { overview } from "@/lib/load";

import "./styles.css";

export const metadata: Metadata = { title: "Wo stehen Sie? — Landkarte des Streits" };

/**
 * Idea 3 (paper: door 1): visitors answer the dispute questions themselves and
 * see which camp and which organisations they are closest to. The votes stay
 * in the browser; the page only reads.
 */
export default async function Abstimmen({
  params,
  searchParams,
}: {
  params: Promise<{ ref: string }>;
  searchParams: Promise<{ m?: string | string[] }>;
}) {
  const { ref } = await params;
  const { m } = await searchParams;
  const o = await overview(ref);
  const base = `/${o.ref}`;
  const data = await loadVoteData(getDb(), o.id);
  const wanted = typeof m === "string" ? m : undefined;
  const preset = wanted ? data.measures.find((x) => x.slug === wanted) : undefined;

  if (data.measures.length === 0) {
    return (
      <header className="page-head">
        <p className="crumbs">
          <a href={base}>Lagebild</a> / Wo stehen Sie?
        </p>
        <h1>Wo stehen Sie?</h1>
        <p className="lead">Für diese Anhörung gibt es noch keine Streitfragen zum Abstimmen.</p>
      </header>
    );
  }

  return <VoteDeck data={data} base={base} initialSlug={(preset ?? data.measures[0]!).slug} fromUrl={Boolean(preset)} />;
}
