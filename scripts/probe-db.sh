#!/usr/bin/env bash
# Create (or refresh) policy_probe: a full copy of the dev database `policy`
# for pipeline test runs — the real database stays untouched until a run is
# approved. Migrations are applied to the copy only.
#   scripts/probe-db.sh            → copy + migrate
#   DATABASE_URL=postgres://policy:policy@localhost:5433/policy_probe <stage>
set -euo pipefail
C=platform-postgres-1
docker exec "$C" psql -U policy -d postgres -qc "DROP DATABASE IF EXISTS policy_probe WITH (FORCE)"
docker exec "$C" psql -U policy -d postgres -qc "CREATE DATABASE policy_probe OWNER policy"
docker exec "$C" sh -c "pg_dump -Fc -U policy policy | pg_restore -U policy -d policy_probe --no-owner"
cd "$(dirname "$0")/.."
DATABASE_URL=postgres://policy:policy@localhost:5433/policy_probe pnpm -s db:migrate
echo "policy_probe ready"
