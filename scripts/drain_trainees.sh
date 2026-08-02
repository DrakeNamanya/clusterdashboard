#!/usr/bin/env bash
# One-time resilient drain of the MIS all_trainees_view backlog into at_rows.
#
# Strategy: the MIS gateway is too slow/unstable for a Cloudflare Worker to fetch
# inside its subrequest budget (13-19s/page, intermittent 500s, >25s timeouts) —
# so Worker-side sync kept upserting 0 rows and "Youth Trained" froze at 99,050
# with 32,556 rows pending. The SANDBOX can reach the gateway reliably, so this
# script fetches each page HERE (generous timeout + retry/backoff) and POSTs the
# raw rows to the deployed Worker's token-gated /api/mis-sync/ingest, which only
# does the cheap DB upsert. at_rows dedups on dedup_key, so pages we already have
# are no-ops; only the ~32k missing rows get inserted.
#
# PAGESIZE defaults to 500 (~0.75MB) NOT 2000 (~3MB): the degraded gateway often
# TRUNCATES a 3MB response mid-stream, which json.load can't parse -> the page
# was silently lost. Smaller pages complete intact, and we now REQUIRE the JSON
# to fully parse before accepting a page (a truncated body is retried, not skipped).
#
# Resumable: START/END select a page window; re-running is safe (idempotent).
#
# Env: MIS creds are read from .dev.vars (run from repo root).

set -u
DEPLOY="${DEPLOY:-https://shg-data-cleaner.pages.dev}"
TOKEN="${TOKEN:-shg-fix-2026}"
PAGESIZE="${PAGESIZE:-500}"
START="${START:-1}"
END="${END:-1600}"
PAUSE="${PAUSE:-2}"        # seconds between pages (gateway-friendly)
MAXRETRY="${MAXRETRY:-6}"

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

# Validate the fetched page and extract its rows into /tmp/mis_ingest.json.
# Exits 0 only if the body FULLY parses as JSON and carries a rows array; on a
# truncated/partial body json.load raises and we exit non-zero (=> retry). Prints
# the row count to stdout on success.
extract_rows(){
  python3 - <<'PY'
import json,sys
try:
    d=json.load(open('/tmp/mis_page.json'))
except Exception as e:
    sys.stderr.write('parse-fail: %s\n' % str(e)[:80]); sys.exit(2)
rows=d.get('rows')
if rows is None:
    sys.stderr.write('no-rows-key\n'); sys.exit(3)
json.dump({"rows":rows}, open('/tmp/mis_ingest.json','w'))
print(len(rows))
PY
}

total_up=0
for ((p=START; p<=END; p++)); do
  attempt=1; served=""; nrows=0
  while :; do
    # 1) fetch page from MIS in the sandbox
    curl -s --max-time 90 -o /tmp/mis_page.json \
      -X POST "$MIS_BASE/data/filter/all_trainees_view?page=$p&limit=$PAGESIZE&search=true" \
      -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' -d '{}'
    # 2) accept ONLY if the body fully parses (guards against truncated payloads)
    if nrows=$(extract_rows 2>/tmp/mis_err.txt); then
      served="yes"; break
    fi
    # token may have expired -> re-login once on a mid-run failure
    if (( attempt == 3 )); then TOK="$(login)"; fi
    if (( attempt >= MAXRETRY )); then
      echo "page $p: FETCH/PARSE FAILED after $attempt tries ($(head -c 80 /tmp/mis_err.txt)); skipping"
      served="no"; break
    fi
    back=$(( attempt * 4 ))
    echo "page $p: bad/truncated response, retry $attempt in ${back}s ($(head -c 60 /tmp/mis_err.txt))"
    sleep "$back"; attempt=$((attempt+1))
  done
  [[ "$served" != "yes" ]] && { sleep "$PAUSE"; continue; }

  if [[ "$nrows" -eq 0 ]]; then
    echo "page $p: 0 rows (end of data) -> stopping"; break
  fi

  # 3) POST the extracted rows to the ingest route
  R=$(curl -s --max-time 90 -X POST "$DEPLOY/api/mis-sync/ingest?token=$TOKEN" \
        -H 'Content-Type: application/json' --data-binary @/tmp/mis_ingest.json)
  up=$(echo "$R" | grep -o '"upserted":[0-9]*' | head -1 | grep -o '[0-9]*')
  at=$(echo "$R" | grep -o '"atRowsCount":[0-9]*' | head -1 | grep -o '[0-9]*')
  if [[ -z "$up" ]]; then
    echo "page $p: INGEST failed -> $(echo "$R" | head -c 160)"
  else
    total_up=$((total_up + up))
    printf "page %4d: fetched=%-4s upserted=%-4s at_rows=%-7s (cum +%s)\n" "$p" "$nrows" "$up" "${at:-?}" "$total_up"
  fi
  sleep "$PAUSE"
done
echo "$(date -u) drain done: cumulative upserted this run = $total_up"
