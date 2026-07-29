# policy platform

Open-source deliberation platform: free-text consultation input → structured
argument map → voting → bridge analysis → deterministic conflict diagnoses →
(eventually) drafted policy text. See the project roadmap in the parent repo.

## Architecture (short version)

TypeScript modular monolith (Next.js + packages) plus **one** Python sidecar
(the document-extraction worker). Postgres is the single source of truth and
the only bus between them (`jobs` table, `SKIP LOCKED`). The core↔worker
contract is zod-defined, emitted as JSON Schema (`packages/contracts/schemas/`,
committed), and validated on both sides.

```
apps/web            Next.js app (participation, editorial, admin) — de/en, RTL-ready
packages/contracts  zod schemas → JSON Schema artifacts for the worker boundary
packages/db         Drizzle schema v0, hand-rolled SQL migrations, RLS policies
worker/             Python extraction worker (PDF/DOCX → text)
```

## Development

```bash
docker compose up -d postgres
cp .env.example .env
pnpm install
pnpm build                    # also emits contract JSON schemas
DATABASE_URL=postgres://policy:policy@localhost:5433/policy pnpm db:migrate
DATABASE_URL=... pnpm --filter @policy/web dev

# worker
python3 -m venv worker/.venv && worker/.venv/bin/pip install -e "worker[dev]"
DATABASE_URL=... BLOB_DIR=./blobs worker/.venv/bin/policy-worker --once
```

Tests: `pnpm test` (DB-backed tests skip without `DATABASE_URL`) and
`worker/.venv/bin/pytest worker/tests`.

## Phase 0 status

- [x] Monorepo (pnpm + Turborepo), Next.js app with next-intl (de/en), RTL smoke test
- [x] Postgres schema v0: tenancy, RLS (tested), append-only audit log (tested), job queue
- [x] Contract generation zod → JSON Schema, validated in the Python worker
- [x] Extraction worker with SKIP LOCKED claim loop and retry/failure handling
- [ ] Auth (OIDC) — next
- [ ] Coolify deployment to the Hetzner box — needs the box

## License

MIT (math package files ported from red-dwarf will carry MPL-2.0 headers).
