#!/usr/bin/env bash
# Autonomous wrapper around drain_trainees.sh for a flaky gateway.
#
# The MIS gateway is only reachable in short bursts (up ~15-30s, then down for
# minutes). This daemon loops the drain over a moving page window: each pass it
# tries to drain PASS_PAGES pages; if login fails (gateway down) it waits and
# retries. When a pass finishes it advances the window so we don't re-walk the
# already-synced front forever. Runs until END is reached or STOPFILE appears.
#
# Progress + cursor are persisted so it is fully resumable across sandbox resets.
#
#   nohup bash scripts/drain_daemon.sh > /tmp/drainlog/daemon.log 2>&1 &
#   touch /tmp/drainlog/STOP    # to stop it gracefully
set -u
cd "$(dirname "$0")/.." || exit 1

PAGESIZE="${PAGESIZE:-500}"
PASS_PAGES="${PASS_PAGES:-40}"     # pages attempted per pass
END="${END:-1700}"                 # ~800k / 500 = 1600 pages, +margin
PAUSE="${PAUSE:-2}"
COOLDOWN="${COOLDOWN:-30}"         # wait between passes / after a gateway-down pass
CURSOR="${CURSOR:-/tmp/drainlog/daemon.cursor}"
STOPFILE="${STOPFILE:-/tmp/drainlog/STOP}"

mkdir -p /tmp/drainlog
start=$(cat "$CURSOR" 2>/dev/null || echo 1)
case "$start" in ''|*[!0-9]*) start=1 ;; esac

echo "$(date -u) daemon start @page $start (pagesize=$PAGESIZE pass=$PASS_PAGES end=$END)"
while :; do
  [[ -f "$STOPFILE" ]] && { echo "$(date -u) STOP file seen -> exit"; break; }
  if (( start > END )); then echo "$(date -u) reached END=$END -> done"; break; fi
  s=$start
  e=$(( start + PASS_PAGES - 1 ))
  (( e > END )) && e=$END
  echo "$(date -u) --- pass pages ${s}..${e} ---"
  # Run one drain pass; capture whether login worked.
  out=$(START=$s END=$e PAGESIZE=$PAGESIZE PAUSE=$PAUSE MAXRETRY=6 bash scripts/drain_trainees.sh 2>&1)
  echo "$out"
  if echo "$out" | grep -q "FATAL: MIS login failed"; then
    echo "$(date -u) gateway down -> cooldown ${COOLDOWN}s, retry SAME window"
    sleep "$COOLDOWN"
    continue    # do NOT advance the cursor; retry same window when gateway returns
  fi
  # Pass completed (login worked). Advance the cursor past this window.
  if echo "$out" | grep -q "end of data"; then
    echo "$(date -u) hit end of data -> done"; break
  fi
  start=$(( e + 1 ))
  echo "$start" > "$CURSOR"
  sleep "$COOLDOWN"
done
echo "$(date -u) daemon exit (next cursor=$start)"
