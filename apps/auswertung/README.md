# Auswertung — the ministry app (prototype)

Frau K.'s path through a consultation (concept paper v7, §1): she has thousands
of statements on a bill and three weeks. This app gives her the report first
("was noch zu klären ist und von wem"), then the bill, the Landkarte per
measure, every point down to its original quote, and the routing slip per
organisation. Shared building blocks live in `packages/landkarte` so the
municipal app (Beteiligung) can reuse them.

Data: read-only, from the Jev-first pipeline (`run-pipeline --jev`). In dev the
app reads the probe copy:

```bash
# apps/auswertung/.env.local (gitignored)
DATABASE_URL=postgres://policy:policy@localhost:5433/policy_probe
pnpm --filter @policy/auswertung dev     # http://localhost:3200 (needs dangerouslyDisableSandbox)
```

The app never writes to the database. "Frag die Landkarte" calls the LLM
(Agent SDK, dev: Max subscription) and answers only from retrieved points.

## Pages (German UI, route = what Frau K. does)

| Route | Idea | What it answers |
|---|---|---|
| `/[ref]` | 1 + 7 | Lagebild: the report — what to clarify, by whom; Verdichtung opener |
| `/[ref]/gesetz` | 2 | The bill, § by §, with how much dispute each section draws |
| `/[ref]/massnahmen/[slug]` | — | Landkarte per measure: verdict, zones, solution space, Einzelforderungen |
| `/[ref]/punkt/[id]` | 8 | One Landkarten-Punkt: who believes it · evidence · origin; Prüfpfad |
| `/[ref]/gutachten` | 5 | Study agenda: factual disputes a short study could settle |
| `/[ref]/organisationen[/id]` | 4 | Profile per organisation + Laufzettel ("was wurde aus unserer Stellungnahme") |
| `/[ref]/abstimmen` | 3 | Wo stehst du? Vote yourself, see your nearest camp and organisations |
| `/[ref]/fragen` | 6 | Frag die Landkarte — answers only with sources |
| `/[ref]/bericht` | 9 | The consultation report, print/PDF |
| `/[ref]/methode` | — | How the map was made; saturation ("hat die Anhörung alles gehört?") |

## Design plan

Subject: a ministry desk officer's file on a bill. The vernacular is the
annotated legal text — a statute with a margin column (Randspalte) carrying
the commentary. That margin is the signature: every finding, section, and
point gets a margin note with its diagnosis mark and the counts behind it.

**Colour** (one meaning per colour — diagnoses own the colours, camps are
monochrome so they never compete with a diagnosis):

| Token | Hex | Meaning |
|---|---|---|
| `--canvas` | `#E9ECEE` | desk around the sheet |
| `--sheet` | `#FFFFFF` | the document |
| `--ink` | `#1E2329` | text, Lager A (solid) |
| `--evidence` | `#24578C` | klärbar · zone of the experts (Gutachter) |
| `--political` | `#A8701A` | Wertung · Kernkonflikt · zone of the council |
| `--bridge` | `#2B7A57` | Brücke der Gründe |
| `--design` | `#6B4C93` | Streit um die Ausgestaltung |
| `--open` | `#7B8189` | offen · Lücke (dashed) · Lager B (hatched) |

Warnung (Scheinbrücke) = political ochre, dashed outline.

**Type**: Literata (serif — headings, legal text, Befund prose; line-height
1.6) and IBM Plex Sans (interface, data, tabular figures). Scale 1.25:
14 / 16 / 20 / 25 / 31 / 39 px. Sentence case everywhere; no all-caps labels.

**Layout**: canvas → centred sheet (max 1180px) in three columns: navigation
(the path, 200px) · reading column (≤ 68ch, left-aligned) · margin (220px).
Below 960px the margin folds under each block; below 640px the navigation
becomes a horizontal strip.

**Principles**: the margin carries the evidence for every sentence; counts
("4 von 6") not percentages; the one motion moment is the Verdichtung opener
(skippable, static under reduced motion); plain German a first-time reader
understands — the paper's terms (Brücke, Lücke, Tür) explained in place.

## Status (prototype, 2026-10-02)

All pages above are built on the WPG data (246 pages checked: all load).
Evidence: `packages/pipeline/scripts/evidence.ts` (Jev, source-evidence.v2)
must have run for the evidence balance (point page, Lagebild, agenda).

Known limits:
- Votes are inferred from the statements (Jev), not cast; no human editorial
  desk yet — the machine editor worked alone.
- "Frag die Landkarte" starts a Claude Code process per question (dev, Max
  subscription): no login, no rate limit — gate it before any deployment.
- Organisation short names and aliases are hard-coded for this hearing
  (`shortOrg`, ask.ts).
- About half of the machine editor's reasons are logged in English (shown
  as such in the Prüfpfad and Laufzettel).
- The BDEW profile (373 arguments) is the heaviest page; the printed report
  runs to ~59 A4 pages because every bridge carries its full Befund.
- `namedSections` exists twice (pipeline + landkarte/bill.ts); ranges
  ("§§ 29 bis 32") count only their ends.
