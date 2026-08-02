#!/usr/bin/env bash
# Quick single MIS gateway login probe. Reads creds from .dev.vars.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

get_var() { grep -E "^$1" .dev.vars | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'" | xargs; }

MIS_BASE=$(get_var MIS_BASE_URL)
MIS_USER=$(get_var MIS_USERNAME)
MIS_PASS=$(get_var MIS_PASSWORD)

echo "base: $MIS_BASE"
CAP="${1:-25}"
code=$(curl -s -o /tmp/lg.json -w "%{http_code} in %{time_total}s" --max-time "$CAP" \
  -X POST "$MIS_BASE/user/login" -H "Content-Type: application/json" \
  -d "{\"username\":\"$MIS_USER\",\"password\":\"$MIS_PASS\"}")
echo "[HTTP $code]"
[ -f /tmp/lg.json ] && head -c 160 /tmp/lg.json && echo
if echo "$code" | grep -q "^200"; then echo "LOGIN OK"; exit 0; else echo "LOGIN NOT OK"; exit 1; fi
