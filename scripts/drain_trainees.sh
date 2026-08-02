#!/usr/bin/env bash
# One-time resilient drain of the MIS all_trainees_view backlog into at_rows.
#
# Strategy: the MIS gateway is too slow/unstable for a Cloudflare Worker to fetch
# inside its subrequest budget (13-19s/page, intermittent 500s, >25s timeouts) —
# so Worker-side sync kept upserting 0 rows and "Youth Trained" froze at 99,050
# with 32,556 rows pending. The SANDBOX can reach the gateway reliably, so this
# script fetches each 2000-row page HERE (generous timeout + retry/backoff) and
# POSTs the raw rows to the deployed Worker's token-gated /api/mis-sync/ingest,
# which only does the cheap DB upsert. at_rows dedups on dedup_key, so pages we
# already have are no-ops; only the ~32k missing rows get inserted.
#
# Env: MIS creds are read from .dev.vars (run from repo root).

set -u
DEPLOY="${DEPLOY:-https://shg-data-cleaner.pages.dev}"
TOKEN="${TOKEN:-shg-fix-2026}"
PAGESIZE="${PAGESIZE:-2000}"
START="${START:-1}"
END="${END:-405}"
PAUSE="${PAUSE:-3}"        # seconds between pages (gateway-friendly)
MAXRETRY="${MAXRETRY:-5}"

set -a; source .dev.vars 2>/dev/null; set +a
MIS_BASE="${MIS_BASE_URL:-https://azure.saye-ug.heifer.org/gateway/api/v1}"

login(){
  curl -s --max-time 45 -X POST "$MIS_BASE/user/login" \
    -H 'Content-Type: application/json' \
    -d "{\"username\":\"$MIS_USERNAME\",\"password\":\"$MIS_PASSWORD\"}" \
    | grep -o '"access_token":"[^"]*"' | head -1 | sed 's/.*:"//;s/"//'
}

TOK="$(login)"
if [[ -z "$TOK" ]]; then echo "FATAL: MIS login failed"; exit 1; fi
echo "$(date -u) drain start: pages ${START}..${END} pagesize=${PAGESIZE} (token len ${#TOK})"

total_up=0
for ((p=START; p<=END; p++)); do
  attempt=1; served=""
  while :; do
    # 1) fetch page from MIS in the sandbox
    curl -s --max-time 90 -o /tmp/mis_page.json \
      -X POST "$MIS_BASE/data/filter/all_trainees_view?page=$p&limit=$PAGESIZE&search=true" \
      -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' -d '{}'
    if grep -q '"totalNumberOfRecords"' /tmp/mis_page.json 2>/dev/null; then
      served="yes"; break
    fi
    # token may have expired -> re-login once on a mid-run failure
    if (( attempt == 3 )); then TOK="$(login)"; fi
    if (( attempt >= MAXRETRY )); then
      echo "page $p: MIS fetch FAILED after $attempt tries ($(head -c 120 /tmp/mis_page.json)); skipping"
      served="no"; break
    fi
    back=$(( attempt * 5 ))
    echo "page $p: MIS 500/timeout, retry $attempt in ${back}s"
    sleep "$back"; attempt=$((attempt+1))
  done
  [[ "$served" != "yes" ]] && { sleep "$PAUSE"; continue; }

  nrows=$(grep -o '"_id"' /tmp/mis_page.json | wc -l)
  if [[ "$nrows" -eq 0 ]]; then
    echo "page $p: 0 rows (end of data) -> stopping"; break
  fi

  # 2) wrap into {"rows":[...]} and POST to the ingest route
  #    (extract the rows array from the MIS response with python for safety)
  python3 - "$p" <<'PY'
import json,sys
p=sys.argv[1]
d=json.load(open('/tmp/mis_page.json'))
rows=d.get('rows') or []
json.dump({"rows":rows}, open('/tmp/mis_ingest.json','w'))
PY

  R=$(curl -s --max-time 90 -X POST "$DEPLOY/api/mis-sync/ingest?token=$TOKEN" \
        -H 'Content-Type: application/json' --data-binary @/tmp/mis_ingest.json)
  up=$(echo "$R" | grep -o '"upserted":[0-9]*' | head -1 | grep -o '[0-9]*')
  at=$(echo "$R" | grep -o '"atRowsCount":[0-9]*' | head -1 | grep -o '[0-9]*')
  if [[ -z "$up" ]]; then
    echo "page $p: INGEST failed -> $(echo "$R" | head -c 160)"
  else
    total_up=$((total_up + up))
    printf "page %3d: fetched=%-4s upserted=%-4s at_rows=%-7s (cum +%s)\n" "$p" "$nrows" "$up" "${at:-?}" "$total_up"
  fi
  sleep "$PAUSE"
done
echo "$(date -u) drain done: cumulative upserted this run = $total_up"
