# Beteiligung — the municipal app

A municipality puts one measure up for discussion ("Soll die Stadt für
Neubauten eine Solarpflicht einführen?"); citizens vote, add points or submit
statements; the Landkarte des Streits tells the council what to clarify and by
whom. Built against Stephan's Gesamtmodell
(`docs/stephan reloaded/Landkarte-des-Streits_Gesamtmodell.html`: phases 0–4,
data model, 12 invariants), his Teilnehmeransicht (citizen screens) and his
results page (claude.ai artifact 9eabYVLUUNDHb7HdkPLGQC: Meinungsraum, "Nach
Befund" / "Nach Argument", source chain).

```bash
# apps/beteiligung/.env.local (gitignored)
DATABASE_URL=postgres://policy:policy@localhost:5433/policy_probe
BETTER_AUTH_SECRET=<openssl rand -hex 32>
BETTER_AUTH_URL=http://localhost:3300
TYPESAFE_API_KEY=<from platform/.env.local>   # Jev, for the core loop's judgments
JEV_CONCURRENCY=4
pnpm --filter @policy/beteiligung dev      # http://localhost:3300 (needs dangerouslyDisableSandbox); starts the worker
tsx scripts/seed-demo.mts [--member <email>] [--statements] [--reset-analysis [--keep-texts]]
                                            # Musterstadt Solarpflicht demo (fictional) + its 7 fictional statements
tsx scripts/open-demo.mts                   # open the demo: skeleton + recommended points released as "demo";
                                            #   after an evaluation: drops results + reports, opens again
tsx scripts/simulate.mts [--participants 300] [--remove]   # simulated voters, fictional demo only, marked everywhere
tsx scripts/drain.mts                       # run queued machine work once without the server
tsx scripts/auth-sql.mts                    # SQL Better Auth needs (copied into migration 0015)
```

The language model runs through the Agent SDK on the local Claude login (dev only;
production sets `ANTHROPIC_API_KEY` or a `CLAUDE_CODE_OAUTH_TOKEN`). `KERN_WORKER=0`
starts the server without the worker.

## Surfaces

| Route | Who | What |
|---|---|---|
| `/` | everyone | Landing page with the opinion-space demo (Stephan's fictional numbers) |
| `/registrieren`, `/anmelden` | municipal staff | Account + municipality (Better Auth, email + password) |
| `/verwaltung` | staff | The municipality's campaigns |
| `/verwaltung/neu` | initiator | New campaign: title, decision question, measure |
| `/verwaltung/[id]` | staff | Measure, justification in four steps, process (doors, period, editorial mode, access), uploads, preparation, opening |
| `/verwaltung/[id]/punkte` | staff | "Begründung und Einwände": the four steps with the town's claims, what supports and attacks each, open critical questions |
| `/verwaltung/[id]/redaktion` | editors | The editorial queue: start skeleton, new points, uncertain assignments, spot checks |
| `/[gemeinde]` | everyone | A municipality's campaigns (not drafts) |
| `/[gemeinde]/[verfahren]` | citizens | Entry screen (Teilnehmeransicht screen 1), no account; invitation code where the town asks for one |
| `/[gemeinde]/[verfahren]/abstimmen` | citizens | Door 1: one statement at a time, fact/value label, agree / disagree / skip; at the end how the others voted |
| `/[gemeinde]/[verfahren]/punkt` | citizens | Door 2: own point in two sentences, Jev checks it while you wait (screen 3) |
| `/[gemeinde]/[verfahren]/stellungnahme` | citizens | Door 3: a full statement, as a private person or for an organisation |
| `/[gemeinde]/[verfahren]/laufzettel/[token]` | citizens | Tracking slip: what became of each argument, machine vs. editors, "Das meint mein Punkt nicht" |
| `/verwaltung/[id]/lagebild` | staff | Live picture: participation, camps (Polis math), saturation, thin statements, unasked questions |
| `/verwaltung/[id]/auswertung` | staff | While open: the results page as it stands (live) + "Beteiligung schließen" (B13). Closed: the stored result (W9), camp names (machine proposes, editors confirm), "Bericht schreiben lassen", reopen while no report is released |
| `/verwaltung/[id]/bericht` | editors | R1 sentence list, R2 text with the sentence IDs per paragraph, R3 check (rules + Jev reader per paragraph), release / reject with a reason (R4), publish (R5, initiator), earlier versions |
| `/[gemeinde]/[verfahren]/ergebnis` | everyone | The published results page in Stephan's design: Meinungsraum, Nach Befund / Nach Argument, detail with camp profiles, quotes, source chain to the original paragraph, gaps, method, open data |
| `/[gemeinde]/[verfahren]/bericht` | everyone | The released report (prints cleanly), with the sentence list it was written from |
| `/[gemeinde]/[verfahren]/daten/[datei]` | everyone | Open export: `abstimmungsmatrix.csv`, `aussagen.json`, `beitraege.json`, `protokoll.json`, `ergebnis.json` |

## Decisions (Florian, 2026-10-25)

- Human editorial gate, with an AI mode per campaign (`params.editorialMode`: mensch / assistiert / ki).
- Step model of the artifact: Lage · Wirkung · Weg · Eingriff (≈ proportionality test); the question→step mapping is a parameter (`QUESTIONS` in `src/lib/params.ts`).
- Citizens without login (pseudonymous cookie, rate limits, optional invite code).
- Demo: Stephan's fictional Musterstadt Solarpflicht, marked fictional everywhere (`campaigns.fictional`).
- Domain later: municipal.saskana.org.

## Data

Migration 0015: `auth_*` (Better Auth, snake_case), `memberships` (user × tenant × role:
initiator / redaktion / betrachter), `campaigns` (1:1 with a consultation, so the pipeline
works unchanged; state machine entwurf → vorbereitung → offen → auswertung → bericht →
veroeffentlicht), `campaign_files` (uploads in the database, ≤ 20 MB). All tenant tables
have RLS policies; every query is scoped to the member's tenant.

## The core loop (milestone 2)

`packages/pipeline/src/kern/` — one loop for every way text comes in (Gesamtmodell §2):

| Step | Who | Where |
|---|---|---|
| E2 start skeleton: the justification → the decision itself + 1–4 claims per step | LLM | `loop.ts` `proposeSkeleton` |
| Z1 text from PDF / DOCX / TXT, stored once (offsets point into it) | code | `text.ts` |
| Z2/Z3 statement → moves: verbatim quote, claim, votable sentence, step, critical question, direction, fact/value/design, evidence class | LLM, one call per 20k window, cached in `extractions` | `prompts.ts` |
| I4 quote located in the text, else the move is dropped | code | `quote-span.ts` |
| rule checks: question fits the step, fact/value fits the question | code | `loop.ts` `checkFields` |
| Z4 same claim / opposite claim / related / new, against the campaign's nodes | Jev (`kern-match.v1`) | `match.ts` |
| Z5 routing: same + P ≥ matchThreshold + second opinion agrees → auto; else editors ("im Zweifel neu") | code | `match.ts` `route` |
| new claim → proposed node (draft) + the machine's recommendation | Jev (`kern-review.v2`) | `review.ts` |
| Z6/Z7 release, reword, merge (same or opposite), reassign, discard, spot checks | editors (or the machine in AI mode) | `decide.ts` |

Nodes are `map_points` (one node = one votable statement, so the vote matrix and the camp math
work unchanged); moves are the new `moves` table; the machine's work is `campaign_jobs`, done one at
a time by the worker in the server process (`src/instrumentation.ts`, `src/lib/worker.ts`).
Migration 0016 (policy_probe only). Every decision is audit-logged with its actor and the
machine's proposal next to it (I11).

Editorial modes: **mensch** — the machine proposes wording and fields, people decide;
**assistiert** — the machine's recommendation is the one-click default; **ki** — the machine
releases and rejects contribution points itself, a share (sampleRate) goes to the editors as
spot checks; personal data and unclear cases stay with people. The start skeleton is always
released by a person (it speaks for the town) — Claude's call, easy to flip.

## Status

Milestone 1 (shell, no AI) done: landing page, sign-up/login/logout, municipality on
sign-up, campaign list/create/edit (measure, four steps, process, uploads), state
entwurf ⇄ vorbereitung, public entry page, municipality page, German 404. Checked by
clicking through: validation keeps input, other municipalities' campaigns are 404,
no horizontal overflow at 375 px, light and dark.

Milestone 2 (the machine and the editors) done: start skeleton, statements through the core
loop, editorial queue in three modes, "Begründung und Einwände" with open critical questions,
opening the participation (state offen; the voting screens follow in M3).

Milestone 3 (the three doors) done: pseudonymous participation per campaign (cookie hash,
optional invitation codes, rate limits); door 1 voting (fewest votes first, facts and values
alternate, the measure itself first, votes per statement version); door 2 checked by Jev while
the citizen waits (same claim → "Ja, das meine ich" counts as a vote; opposite → counts as
disagreement; never the measure itself), else through the core loop to the editors; door 3
uploads read at once; tracking slip per contribution with "Was genau geändert wurde" and the
author's objection back into the queue; derived votes (assumption 3) recomputed from the moves
(`kern/votes.ts`); live picture for the town. Migration 0017.

Milestone 4 (evaluation and report) done. Closing the participation (B13) freezes the votes;
the result object is computed once more and stored unchangeable (W9, `campaign_results`, with
the hashes of matrix and graph). The evaluation is code, no AI (`kern/befund.ts`, tested):

| Rule | From | To |
|---|---|---|
| a camp holds a position | ≥ 3 votes in the camp, share ≥ bridgeThreshold, significant (Polis test) | carries / rejects |
| profile | all camps carry · all reject · some do · none | getragen · abgelehnt · trennt · unentschieden |
| finding ("Nach Befund") | getragen (+ agreeing contributions that want opposite things for the measure → Scheinkonsens) · abgelehnt · trennt T · trennt W/V · unentschieden (T with proof → klärbar) | Brücke / Vorsicht · Brücke · klärbar · Streit · offen |
| attack status ("Nach Argument") | every camp backs the thesis · every camp the attack · some camps, fact · some camps, value · none | abgewehrt · hält · klärbar · hält · offen (klärbar with proof) |
| step verdict | value attack holds or a value premise of the town not carried → fällt; fact/design attack holds or hidden in an agreement → wackelt | hält · wackelt · fällt |
| W5 per camp pair | the measure + premises; facts and values that divide | Brücke der Gründe / der Ergebnisse · Wertkonflikt · Scheinfaktenstreit · gemischt |
| W6, W7 | questions without objection or answer; questions spoken to from one side; evidence by class at fact statements | gaps, evidence balance |

Words come from fixed templates (`kern/befund-text.ts`), shared by the results page and the
report. The report (`kern/bericht.ts`): R1 sentence list with IDs (templates), R2 the language
model writes paragraphs that name their sentence IDs, R3 rules (every paragraph traceable,
every sentence rendered, no number or statement not in its sentences) plus Jev as an
independent reader (fidelity, direction, strength per paragraph, < 50 % fails); on failure R2
once more with the objections. The editors release or reject with a reason (a new version
reads it); changing camp names withdraws an unreleased report. Migration 0018.

Next: M5 hardening.

Known limits: no email yet (no verification or password reset); one municipality per
account (first membership); colleagues cannot be invited yet; one worker for all
municipalities (a long job makes others wait); no OCR for scanned PDFs; Q1 (agreement
machine vs. editors) is recorded but not shown yet; a citizen who clears cookies is a new
pseudonym (limited per connection, not prevented — invitation codes are the strict mode);
closing needs enough participants for camps (no result without camps); the Scheinkonsens rule
needs contributions whose direction differs (door-2 confirmations carry no direction); the
demo's voters are simulated (`scripts/simulate.mts`, marked on every page and in the report).
