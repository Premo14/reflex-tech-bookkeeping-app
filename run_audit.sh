#!/usr/bin/env bash
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

# Ensure Hermes-managed Node/npm/Python tools are on PATH for frontend Vitest/Vite verification.
for tool_bin in "$HOME"/.hermes/tools/*/bin; do
  if [ -d "$tool_bin" ] && [[ ":$PATH:" != *":$tool_bin:"* ]]; then
    export PATH="$tool_bin:$PATH"
  fi
done

MAX_RUNS="${MAX_RUNS:-60}"
MAX_TURNS="${MAX_TURNS:-130}"
RUN_BUDGET="${RUN_BUDGET:-3600}"
STALL_LIMIT="${STALL_LIMIT:-5}"
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
  grep -cE '^- \[( |-)\] \*\*S[0-9]+[A-Z]*:' AUDIT_QUEUE.md || true
}

completed_slices() {
  grep -cE '^- \[x\] \*\*S[0-9]+[A-Z]*:' AUDIT_QUEUE.md || true
}

strip_bogus_complete_banner() {
  if [ "$(remaining_slices)" -gt 0 ] && grep -q '^STATUS: ALL_COMPLETE' AUDIT_QUEUE.md; then
    echo "⚠️  Removed premature STATUS: ALL_COMPLETE from AUDIT_QUEUE.md ($(remaining_slices) slices still remain)."
    grep -v '^STATUS: ALL_COMPLETE$' AUDIT_QUEUE.md > AUDIT_QUEUE.md.tmp && mv AUDIT_QUEUE.md.tmp AUDIT_QUEUE.md
  fi
}

strip_bogus_complete_banner
prev_remaining="$(remaining_slices)"
prev_head="$(git rev-parse HEAD 2>/dev/null || echo none)"
stall_count=0

for i in $(seq 1 "$MAX_RUNS"); do
  done_now="$(completed_slices)"
  rem_now="$(remaining_slices)"
  if [ "$rem_now" -eq 0 ] && [ "$done_now" -gt 0 ]; then
    echo "✅ All $done_now audit slices complete after $((i - 1)) runs."
    exit 0
  fi

  log_file=".audit_logs/run_$(date '+%Y%m%d_%H%M%S')_iter${i}.log"
  echo "=== [Run $i/$MAX_RUNS | Done: $done_now | Remaining slices: $rem_now] $(date '+%Y-%m-%d %H:%M:%S') ==="

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

  strip_bogus_complete_banner
  curr_remaining="$(remaining_slices)"
  curr_done="$(completed_slices)"
  curr_head="$(git rev-parse HEAD 2>/dev/null || echo none)"

  if [ "$curr_remaining" -eq 0 ] && [ "$curr_done" -gt 0 ]; then
    echo "✅ All $curr_done audit slices complete on run $i."
    exit 0
  fi

  if [ "$curr_remaining" -lt "$prev_remaining" ] || [ "$curr_head" != "$prev_head" ]; then
    stall_count=0
    prev_remaining="$curr_remaining"
    prev_head="$curr_head"
  else
    stall_count=$((stall_count + 1))
    echo "⚠️  No slice or commit progress on run $i ($stall_count/$STALL_LIMIT before pause)."
    if [ "$stall_count" -ge "$STALL_LIMIT" ]; then
      echo "❌ Stopped: $STALL_LIMIT consecutive runs made no slice or commit progress. Inspect $log_file and AUDIT_QUEUE.md."
      exit 1
    fi
  fi

  sleep 2
done

echo "Reached MAX_RUNS=$MAX_RUNS with $(remaining_slices) slices remaining. Re-run ./run_audit.sh to continue."
