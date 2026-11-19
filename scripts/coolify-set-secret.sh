#!/usr/bin/env bash
# Put a secret setting (API key, token) into the streit.bar app in Coolify, without the web UI and
# without the value showing up anywhere: you paste it at a hidden prompt, it goes through an SSH
# tunnel straight to Coolify's API. Takes effect with the next deploy.
#
#   scripts/coolify-set-secret.sh RESEND_API_KEY
#
# Needs: SSH access to the server, the Coolify API token in the swarmit-coolify README (line 18).
set -euo pipefail

KEY="${1:?Name der Einstellung angeben, z. B. RESEND_API_KEY}"
APP=9sg6yv8psm5zzdndb5ltufjm
TOKEN_FILE="$HOME/Git/freedom-dev/swarmit-coolify/README.md"
TOKEN=$(sed -n '18p' "$TOKEN_FILE" | grep -oE '[0-9]+\|[A-Za-z0-9]+' | head -1 || true)
[ -n "$TOKEN" ] || { echo "Coolify-Token nicht gefunden ($TOKEN_FILE, Zeile 18)." >&2; exit 1; }

# Coolify's port is closed to the internet: open a tunnel if none is running.
if ! curl -s -o /dev/null --max-time 3 http://localhost:18000/api/health; then
  ssh -o BatchMode=yes -f -N -L 18000:localhost:8000 root@5.78.195.10
  sleep 1
fi

read -r -s -p "Wert für $KEY einfügen (bleibt unsichtbar), dann Enter: " VALUE
echo
[ -n "$VALUE" ] || { echo "Nichts eingegeben, nichts geändert." >&2; exit 1; }

BODY=$(KEY="$KEY" VALUE="$VALUE" python3 -c 'import json, os; print(json.dumps({"key": os.environ["KEY"], "value": os.environ["VALUE"], "is_preview": False, "is_literal": True}))')
unset VALUE
URL="http://localhost:18000/api/v1/applications/$APP/envs"
AUTH="Authorization: Bearer $TOKEN"

# Change it if it exists, otherwise create it.
code=$(curl -s -o /dev/null -w '%{http_code}' -X PATCH -H "$AUTH" -H 'Content-Type: application/json' --data "$BODY" "$URL")
if [ "${code:0:1}" != "2" ]; then
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "$AUTH" -H 'Content-Type: application/json' --data "$BODY" "$URL")
fi
unset BODY
if [ "${code:0:1}" = "2" ]; then
  echo "Fertig: $KEY ist in Coolify gespeichert. Es gilt ab dem nächsten Deploy."
else
  echo "Hat nicht geklappt (Coolify antwortet $code)." >&2
  exit 1
fi
