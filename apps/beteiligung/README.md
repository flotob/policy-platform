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
pnpm --filter @policy/beteiligung dev      # http://localhost:3300 (needs dangerouslyDisableSandbox)
tsx scripts/seed-demo.mts [--member <email>]   # Musterstadt Solarpflicht demo (fictional)
tsx scripts/auth-sql.mts                    # SQL Better Auth needs (copied into migration 0015)
```

## Surfaces

| Route | Who | What |
|---|---|---|
| `/` | everyone | Landing page with the opinion-space demo (Stephan's fictional numbers) |
| `/registrieren`, `/anmelden` | municipal staff | Account + municipality (Better Auth, email + password) |
| `/verwaltung` | staff | The municipality's campaigns |
| `/verwaltung/neu` | initiator | New campaign: title, decision question, measure |
| `/verwaltung/[id]` | staff | Measure, justification in four steps, process (doors, period, editorial mode, access), uploads, preparation |
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

## Status

Milestone 1 (shell, no AI) done: landing page, sign-up/login/logout, municipality on
sign-up, campaign list/create/edit (measure, four steps, process, uploads), state
entwurf ⇄ vorbereitung, public entry page, municipality page, German 404. Checked by
clicking through: validation keeps input, other municipalities' campaigns are 404,
no horizontal overflow at 375 px, light and dark.

Next: M2 setup analysis (skeleton from the justification, uploads through the core
loop, editorial queue, open the campaign) → M3 citizen doors 1–3, live recompute →
M4 results page in Stephan's design + report → M5 hardening.

Known limits: no email yet (no verification or password reset); one municipality per
account (first membership); colleagues cannot be invited yet.
