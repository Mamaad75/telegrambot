#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Baimar Lead Intelligence — full verification gate.
#
#   ./scripts/verify.sh              typecheck + unit + e2e + build
#   ./scripts/verify.sh --no-e2e     skip the tests that need Postgres and Redis
#   ./scripts/verify.sh --fast       typecheck + unit only
#
# Exits non-zero on the first failing stage and prints a summary table, so it can
# be dropped straight into CI or a pre-push hook.
# ---------------------------------------------------------------------------
set -uo pipefail

cd "$(dirname "$0")/.."

RUN_E2E=1
RUN_BUILD=1
for arg in "$@"; do
  case "$arg" in
    --no-e2e) RUN_E2E=0 ;;
    --fast)   RUN_E2E=0; RUN_BUILD=0 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

RESULTS=()
FAILED=0

run_stage() {
  local name="$1"; shift
  echo ""
  echo "────────────────────────────────────────────────────────────"
  echo "  $name"
  echo "────────────────────────────────────────────────────────────"
  local start; start=$(date +%s)
  if "$@"; then
    RESULTS+=("PASS  $name  ($(( $(date +%s) - start ))s)")
  else
    RESULTS+=("FAIL  $name  ($(( $(date +%s) - start ))s)")
    FAILED=1
    return 1
  fi
}

run_stage "typecheck"   npm run typecheck              || true
[ $FAILED -eq 0 ] && { run_stage "unit tests"  npm test          || true; }
if [ $FAILED -eq 0 ] && [ $RUN_E2E -eq 1 ]; then
  run_stage "e2e tests" npm run test:e2e                || true
fi
if [ $FAILED -eq 0 ] && [ $RUN_BUILD -eq 1 ]; then
  run_stage "build"     npm run build                   || true
fi

echo ""
echo "════════════════════════════════════════════════════════════"
for line in "${RESULTS[@]}"; do echo "  $line"; done
echo "════════════════════════════════════════════════════════════"

if [ $FAILED -ne 0 ]; then
  echo "VERIFICATION FAILED" >&2
  exit 1
fi
echo "VERIFICATION PASSED"
