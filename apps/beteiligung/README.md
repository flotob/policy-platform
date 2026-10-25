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
| `/[gemeinde]/[verfahren]` | citizens | Entry screen (Teilnehmeransicht screen 1), no account |

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

Next: M3 citizen doors 1–3 (vote, short statement through the same loop, upload), live
recompute → M4 results page in Stephan's design + report → M5 hardening.

Known limits: no email yet (no verification or password reset); one municipality per
account (first membership); colleagues cannot be invited yet; one worker for all
municipalities (a long job makes others wait); no OCR for scanned PDFs; Q1 (agreement
machine vs. editors) is recorded but not shown yet.
