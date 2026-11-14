#!/usr/bin/env bash
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

MAX_RUNS="${MAX_RUNS:-40}"
MAX_TURNS="${MAX_TURNS:-80}"
RUN_BUDGET="${RUN_BUDGET:-2400}"
STALL_LIMIT="${STALL_LIMIT:-3}"
HERMES_BIN="${HERMES_BIN:-hermes}"
HERMES_REASONING="${HERMES_REASONING:-low}"
HERMES_QUIET="${HERMES_QUIET:-0}"

mkdir -p .audit_logs

if ! command -v "$HERMES_BIN" >/dev/null 2>&1; then
  echo "ERROR: '$HERMES_BIN' not found in PATH."
  exit 1
fi

EXTRA_FLAGS=(--reasoning "$HERMES_REASONING")
if [ -n "${HERMES_MODEL:-}" ]; then
  EXTRA_FLAGS+=(--model "$HERMES_MODEL")
fi
if [ -n "${HERMES_PROVIDER:-}" ]; then
  EXTRA_FLAGS+=(--provider "$HERMES_PROVIDER")
fi
if [ "${HERMES_YOLO:-0}" = "1" ]; then
  EXTRA_FLAGS+=(--yolo)
fi
if [ "${HERMES_QUIET:-0}" = "1" ]; then
  EXTRA_FLAGS+=(-Q)
fi

remaining_slices() {
  grep -cE '^- \[( |-)\] \*\*S[0-9]+' AUDIT_QUEUE.md || true
}

prev_remaining="$(remaining_slices)"
stall_count=0

for i in $(seq 1 "$MAX_RUNS"); do
  if [ -f AUDIT_QUEUE.md ] && grep -q '^STATUS: ALL_COMPLETE' AUDIT_QUEUE.md; then
    echo "✅ All audit slices complete after $((i - 1)) runs."
    exit 0
  fi

  log_file=".audit_logs/run_$(date '+%Y%m%d_%H%M%S')_iter${i}.log"
  echo "=== [Run $i/$MAX_RUNS | Remaining slices: $prev_remaining] $(date '+%Y-%m-%d %H:%M:%S') ==="

  set +e
  "$HERMES_BIN" chat \
    --oneshot \
    --query-file AUDIT_PROMPT.md \
    --max-turns "$MAX_TURNS" \
    --run-budget "$RUN_BUDGET" \
    --checkpoints \
    "${EXTRA_FLAGS[@]}" \
    2>&1 | tee "$log_file"
  hermes_ec=${PIPESTATUS[0]}
  set -e

  if [ "$hermes_ec" -ne 0 ]; then
    echo "⚠️  Hermes exited with code $hermes_ec on run $i (see $log_file). Checking queue progress..."
  fi

  if grep -q '^STATUS: ALL_COMPLETE' AUDIT_QUEUE.md; then
    echo "✅ All audit slices complete on run $i."
    exit 0
  fi

  curr_remaining="$(remaining_slices)"
  if [ "$curr_remaining" -ge "$prev_remaining" ]; then
    stall_count=$((stall_count + 1))
    echo "⚠️  No slice completed on run $i ($stall_count/$STALL_LIMIT before pause)."
    if [ "$stall_count" -ge "$STALL_LIMIT" ]; then
      echo "❌ Stopped: $STALL_LIMIT consecutive runs did not complete a slice. Inspect $log_file and AUDIT_QUEUE.md."
      exit 1
    fi
  else
    stall_count=0
    prev_remaining="$curr_remaining"
  fi

  sleep 2
done

echo "Reached MAX_RUNS=$MAX_RUNS with $prev_remaining slices remaining. Re-run ./run_audit.sh to continue."
