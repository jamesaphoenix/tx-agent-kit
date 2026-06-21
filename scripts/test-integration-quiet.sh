#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$SCRIPT_DIR/run-silent.sh"

cd "$PROJECT_ROOT"

should_source_local_env() {
  if [[ ! -f "$PROJECT_ROOT/.env" ]]; then
    return 1
  fi

  if [[ "${CI:-}" == "true" && "${TX_SOURCE_ENV_IN_CI:-0}" != "1" ]]; then
    echo "Skipping local .env sourcing in CI (set TX_SOURCE_ENV_IN_CI=1 to opt in)."
    return 1
  fi

  return 0
}

source_local_env() {
  if ! should_source_local_env; then
    return 0
  fi

  # Match scripts/test/run-integration.sh and dev entrypoints: materialize
  # op:// references before Vitest global setup starts shared services.
  # CI already provides its integration env explicitly; sourcing a generated
  # .env there can replace those values with unresolved op:// placeholders.
  # shellcheck disable=SC1091
  source "$PROJECT_ROOT/scripts/lib/source-env.sh"
  source_env "$PROJECT_ROOT/.env"
}

source_generated_local_infra_env() {
  local env_file="$PROJECT_ROOT/.artifacts/local-infra.env"
  if [[ ! -f "$env_file" ]]; then
    return 0
  fi

  set -a
  # shellcheck disable=SC1090
  source "$env_file"
  set +a
}

FILTER=""
REQUEST_SKIP_PGTAP="${INTEGRATION_SKIP_PGTAP:-}"
REQUEST_DRY_RUN="${INTEGRATION_DRY_RUN:-}"
REQUEST_PLAN="${INTEGRATION_AFFECTED_PLAN_ONLY:-}"

discover_integration_project_map() {
  node "$PROJECT_ROOT/scripts/lib/discover-integration-projects.mjs"
}

resolve_project_ids_from_filter() {
  local filter="$1"
  local project_ids=()
  local normalized_filter
  normalized_filter="$(echo "$filter" | tr '[:upper:]' '[:lower:]')"

  while IFS=$'\t' read -r package_name project_id _config_path; do
    if [[ -z "$package_name" || -z "$project_id" ]]; then
      continue
    fi

    local normalized_package_name
    normalized_package_name="$(echo "$package_name" | tr '[:upper:]' '[:lower:]')"
    if [[ "$normalized_package_name" == *"$normalized_filter"* ]]; then
      project_ids+=("$project_id")
    fi
  done < <(discover_integration_project_map)

  if [[ ${#project_ids[@]} -eq 0 ]]; then
    return 1
  fi

  local csv
  csv="$(IFS=,; echo "${project_ids[*]}")"
  printf '%s\n' "$csv"
}

echo "Running integration tests (quiet mode, global workspace setup)"

# Observability preflight recency marker — the check emits + verifies traces
# end-to-end through Prometheus/Jaeger/Loki/Grafana/OTEL/Spotlight and
# takes ~4.2s. It catches misconfigurations, but between consecutive runs
# in the same dev loop nothing changes. Skip when a marker <1h old exists.
# Scope the marker by COMPOSE_PROJECT_NAME (default: tx-agent-kit) so sibling
# checkouts don't collide. Override with TX_FORCE_FRESH_OBSERVABILITY_PREFLIGHT=1.
OBSERVABILITY_MARKER_SCOPE="${COMPOSE_PROJECT_NAME:-tx-agent-kit}"
OBSERVABILITY_MARKER="/tmp/${OBSERVABILITY_MARKER_SCOPE}-observability-preflight.marker"
OBSERVABILITY_MARKER_TTL_SECONDS="${OBSERVABILITY_MARKER_TTL_SECONDS:-3600}"
should_run_observability_preflight() {
  if [[ "${INTEGRATION_SKIP_OBSERVABILITY:-0}" == "1" ]]; then
    return 1
  fi
  if [[ "${TX_FORCE_FRESH_OBSERVABILITY_PREFLIGHT:-0}" == "1" ]]; then
    return 0
  fi
  if [[ ! -f "$OBSERVABILITY_MARKER" ]]; then
    return 0
  fi
  local marker_mtime now age
  marker_mtime="$(stat -f %m "$OBSERVABILITY_MARKER" 2>/dev/null || stat -c %Y "$OBSERVABILITY_MARKER" 2>/dev/null || echo 0)"
  now="$(date +%s)"
  age=$(( now - marker_mtime ))
  if (( age < 0 || age >= OBSERVABILITY_MARKER_TTL_SECONDS )); then
    return 0
  fi
  return 1
}
touch_observability_marker() {
  touch "$OBSERVABILITY_MARKER" 2>/dev/null || true
}
print_observability_preflight_skip_reason() {
  if [[ "${INTEGRATION_SKIP_OBSERVABILITY:-0}" == "1" ]]; then
    echo "  SKIP observability infra health (INTEGRATION_SKIP_OBSERVABILITY=1)"
    return
  fi

  echo "  SKIP observability infra health (marker <1h; set TX_FORCE_FRESH_OBSERVABILITY_PREFLIGHT=1 to force)"
}

ARGS=("$@")
i=0
while [[ $i -lt ${#ARGS[@]} ]]; do
  arg="${ARGS[$i]}"

  if [[ "$arg" == "--" ]]; then
    i=$((i + 1))
    continue
  fi

  if [[ "$arg" == --filter=* ]]; then
    FILTER="${arg#--filter=}"
    i=$((i + 1))
    continue
  fi

  if [[ "$arg" == "--filter" ]]; then
    if [[ $((i + 1)) -ge ${#ARGS[@]} ]]; then
      echo "Missing value for --filter"
      exit 1
    fi
    FILTER="${ARGS[$((i + 1))]}"
    i=$((i + 2))
    continue
  fi

  if [[ "$arg" == "--skip-pgtap" ]]; then
    REQUEST_SKIP_PGTAP="1"
    i=$((i + 1))
    continue
  fi

  if [[ "$arg" == "--dry-run" ]]; then
    REQUEST_DRY_RUN="1"
    i=$((i + 1))
    continue
  fi

  # `--plan` prints the affected-mode decision (FULL vs the affected project
  # CSV) and exits without running anything. It is only meaningful on the
  # default (affected) path; see the routing block below.
  if [[ "$arg" == "--plan" ]]; then
    REQUEST_PLAN="1"
    i=$((i + 1))
    continue
  fi

  if [[ -z "$FILTER" ]]; then
    FILTER="$arg"
    i=$((i + 1))
    continue
  fi

  echo "Unknown argument: $arg"
  exit 1
done

# ── Affected-by-default routing (LOCAL ONLY) ─────────────────────────
# The default local integration command runs ONLY the projects affected since
# the base ref. CI always runs the full suite, and the affected path is
# UNREACHABLE when CI=true. The affected runner falls back to FULL on any
# ambiguity or sentinel change, always includes the core `api` project, and
# execs back into THIS runner with INTEGRATION_PROJECTS +
# TX_INTEGRATION_AFFECTED_ACTIVE set (so infra preflight, the observability
# marker, the wall-clock budget, slow-test reporting, and orphan/exit handling
# all run exactly once on the delegated invocation).
#
# We do NOT route (the caller already chose, or full is mandated) when:
#   - CI=true                          -> CI is always full (hard guard).
#   - TX_INTEGRATION_FULL=1            -> local opt-out to force full.
#   - TX_INTEGRATION_AFFECTED_ACTIVE=1 -> recursion guard: the affected runner
#                                          is delegating back into this runner.
#   - INTEGRATION_PROJECTS already set -> caller scoped projects explicitly.
#   - a --filter scope                 -> caller scoped a file/pattern.
#   - a dry-run was requested          -> the dry-run summary path handles it.
should_route_to_affected() {
  if [[ "${CI:-}" == "true" ]]; then
    return 1
  fi
  if [[ "${TX_INTEGRATION_FULL:-0}" == "1" ]]; then
    return 1
  fi
  if [[ "${TX_INTEGRATION_AFFECTED_ACTIVE:-0}" == "1" ]]; then
    return 1
  fi
  if [[ -n "${INTEGRATION_PROJECTS:-}" ]]; then
    return 1
  fi
  if [[ -n "$FILTER" ]]; then
    return 1
  fi
  return 0
}

# `--plan` only describes the affected decision; resolve it before any run.
# When full is mandated (CI / opt-out / already-scoped) print why and exit; the
# affected runner itself prints the FULL-vs-affected plan on the affected path.
if [[ -n "$REQUEST_PLAN" ]]; then
  if [[ "${CI:-}" == "true" ]]; then
    echo "PLAN: FULL integration suite (CI; affected selection is never used in CI)"
    exit 0
  fi
  if [[ "${TX_INTEGRATION_FULL:-0}" == "1" ]]; then
    echo "PLAN: FULL integration suite (TX_INTEGRATION_FULL=1 local opt-out)"
    exit 0
  fi
  if [[ -n "${INTEGRATION_PROJECTS:-}" ]]; then
    echo "PLAN: scoped integration suite (INTEGRATION_PROJECTS=${INTEGRATION_PROJECTS})"
    exit 0
  fi
  if [[ -n "$FILTER" ]]; then
    echo "PLAN: scoped integration suite (--filter=${FILTER})"
    exit 0
  fi
  exec env INTEGRATION_AFFECTED_PLAN_ONLY=1 "$SCRIPT_DIR/test-integration-affected.sh"
fi

if should_route_to_affected; then
  exec "$SCRIPT_DIR/test-integration-affected.sh"
fi

# Banner: state the mode + why before any infra work begins. When the affected
# helper delegated here (TX_INTEGRATION_AFFECTED_ACTIVE=1) it already printed the
# AFFECTED/FULL reason, so we do not double-print.
if [[ "${TX_INTEGRATION_AFFECTED_ACTIVE:-0}" != "1" ]]; then
  if [[ "${CI:-}" == "true" ]]; then
    echo "FULL: CI (affected selection is never used in CI)"
  elif [[ "${TX_INTEGRATION_FULL:-0}" == "1" ]]; then
    echo "FULL: TX_INTEGRATION_FULL=1 (local opt-out)"
  elif [[ -n "${INTEGRATION_PROJECTS:-}" ]]; then
    echo "SCOPED: INTEGRATION_PROJECTS=${INTEGRATION_PROJECTS}"
  elif [[ -n "$FILTER" ]]; then
    echo "SCOPED: --filter=${FILTER}"
  fi
fi

if [[ -n "$REQUEST_DRY_RUN" ]]; then
  if [[ -n "$FILTER" ]]; then
    if ! project_ids="$(resolve_project_ids_from_filter "$FILTER")"; then
      echo "No integration projects matched filter: '$FILTER'"
      exit 1
    fi
    echo "Integration quiet runner dry-run summary:"
    echo "  INTEGRATION_PROJECTS=$project_ids"
  else
    echo "Integration quiet runner dry-run summary:"
    echo "  INTEGRATION_PROJECTS=all"
  fi
  echo "  INTEGRATION_SKIP_PGTAP=${REQUEST_SKIP_PGTAP:-0}"
  exit 0
fi

# ── Pre-test infrastructure checks (parallelized where safe) ─────────
PREFLIGHT_FAILED=0

if [[ "${INTEGRATION_SKIP_INFRA_ENSURE:-0}" != "1" ]]; then
  # Run infra ensure first so adopted/fallback Compose ports can be handed
  # back to this runner before observability validation starts.
  run_silent "infra ensure" "pnpm infra:ensure" &
  INFRA_PID=$!

  if ! wait "$INFRA_PID"; then
    echo "  FAIL infra ensure"
    PREFLIGHT_FAILED=1
  fi

  source_local_env
  source_generated_local_infra_env

  if [[ "${TEMPORAL_RUNTIME_MODE:-cli}" == "cli" ]]; then
    run_silent "temporal cli ensure" "pnpm temporal:dev:up" &
    TEMPORAL_PID=$!
  else
    TEMPORAL_PID=""
  fi

  if should_run_observability_preflight; then
    run_silent "observability infra health" "pnpm test:infra:observability" &
    OBSERVABILITY_PID=$!
  else
    print_observability_preflight_skip_reason
    OBSERVABILITY_PID=""
  fi

  if [[ -n "$TEMPORAL_PID" ]] && ! wait "$TEMPORAL_PID"; then
    echo "  FAIL temporal cli ensure"
    PREFLIGHT_FAILED=1
  fi

  if [[ -n "$OBSERVABILITY_PID" ]]; then
    if ! wait "$OBSERVABILITY_PID"; then
      echo "  FAIL observability infra health"
      PREFLIGHT_FAILED=1
    else
      touch_observability_marker
    fi
  fi

  if [[ "$PREFLIGHT_FAILED" == "1" ]]; then
    echo "Integration tests failed (preflight checks)"
    exit 1
  fi
else
  echo "Skipping infra ensure bootstrap (INTEGRATION_SKIP_INFRA_ENSURE=1)"
  source_local_env
  source_generated_local_infra_env

  if should_run_observability_preflight; then
    echo "Observability health check remains mandatory."
    if ! run_silent "observability infra health" "pnpm test:infra:observability"; then
      echo "Integration tests failed"
      exit 1
    fi
    touch_observability_marker
  else
    print_observability_preflight_skip_reason
  fi
fi

env_prefix_cmd=""
if [[ -n "$REQUEST_SKIP_PGTAP" ]]; then
  env_prefix_cmd="INTEGRATION_SKIP_PGTAP=$REQUEST_SKIP_PGTAP "
fi

if [[ -n "$FILTER" ]]; then
  if ! project_ids="$(resolve_project_ids_from_filter "$FILTER")"; then
    echo "No integration projects matched filter: '$FILTER'"
    exit 1
  fi

  if ! run_silent "integration workspace (projects=$project_ids)" "${env_prefix_cmd}INTEGRATION_PROJECTS=$project_ids pnpm exec vitest run -c vitest.integration.workspace.ts"; then
    echo "Integration tests failed (filtered)"
    exit 1
  fi

  echo "Integration tests completed (filtered)"
  exit 0
fi

# ── Full integration run with wall-clock budget enforcement ──────────

if [[ "${CI:-}" == "true" ]]; then
  # CI runners are slower; disable timeout but still report slow tests
  INTEGRATION_TIMEOUT_SECONDS="${INTEGRATION_TIMEOUT_SECONDS:-0}"
else
  INTEGRATION_TIMEOUT_SECONDS="${INTEGRATION_TIMEOUT_SECONDS:-120}"
fi
SLOW_TEST_THRESHOLD_MS="${SLOW_TEST_THRESHOLD_MS:-10000}"

extract_slow_tests() {
  local file="$1"
  local threshold="$2"
  # Strip ANSI colors, then find every line that ends with `<N>ms`. Vitest
  # emits two relevant shapes:
  #   ' ✓  project-name  src/path/to/file.test.ts (N tests) 12345ms'
  #   '    ✓ describe block > test name 12345ms'
  # Print the WHOLE line (minus leading status markers) so the slow-test
  # report actually names the offender. The previous extractor was using
  # `grep -oE '[^ ]+[[:space:]]+[0-9]+ms$'` which only captured from the
  # final whitespace and dropped the file path entirely (printed literal
  # 'tests) 12345ms' with no idea which file it was).
  sed 's/\x1b\[[0-9;]*m//g' "$file" \
    | grep -E ' [0-9]+ms$' \
    | while IFS= read -r line; do
        ms="${line##* }"
        ms="${ms%ms}"
        case "$ms" in
          ''|*[!0-9]*) continue ;;
        esac
        if (( ms < threshold )); then
          continue
        fi
        # Trim leading whitespace + ASCII test markers (✓ × ❯ ↓).
        clean="$(printf '%s' "$line" | sed -E 's/^[[:space:]]*([✓×❯↓»]+[[:space:]]+)*//')"
        printf '  SLOW (%sms): %s\n' "$ms" "$clean"
      done \
    | sort -rn \
    | head -20
}

# CI: use run_silent (proven stable). Local: use background monitoring for timeout.
if [[ "${CI:-}" == "true" ]]; then
  if ! run_silent "integration workspace (all projects)" "${env_prefix_cmd}pnpm exec vitest run -c vitest.integration.workspace.ts"; then
    echo "Integration tests failed"
    exit 1
  fi
  echo "Integration tests completed"
  exit 0
fi

# Disable errexit for vitest run — we check results explicitly
set +e

vitest_output_file="$(mktemp)"
vitest_cmd="${env_prefix_cmd}pnpm exec vitest run -c vitest.integration.workspace.ts"
vitest_start_time="$SECONDS"

eval "$vitest_cmd" >"$vitest_output_file" 2>&1 &
VITEST_PID=$!

# Monitor wall-clock budget (0 = no timeout, used in CI)
while kill -0 "$VITEST_PID" 2>/dev/null; do
  elapsed=$((SECONDS - vitest_start_time))
  if (( INTEGRATION_TIMEOUT_SECONDS > 0 && elapsed > INTEGRATION_TIMEOUT_SECONDS )); then
    echo ""
    echo "================================================================"
    echo "INTEGRATION TIMEOUT: exceeded ${INTEGRATION_TIMEOUT_SECONDS}s budget (${elapsed}s elapsed)"
    echo "================================================================"
    echo ""
    echo "Slow tests detected:"
    extract_slow_tests "$vitest_output_file" "$SLOW_TEST_THRESHOLD_MS"
    echo ""
    echo "Kill the vitest process and fail."
    kill "$VITEST_PID" 2>/dev/null
    wait "$VITEST_PID" 2>/dev/null
    rm -f "$vitest_output_file"
    exit 1
  fi
  sleep 2
done

wait "$VITEST_PID"
vitest_exit=$?
vitest_elapsed=$((SECONDS - vitest_start_time))

# Always report slow tests
slow_tests="$(extract_slow_tests "$vitest_output_file" "$SLOW_TEST_THRESHOLD_MS")"

# Print summary
summary="$(grep -E "Test Files|Tests " "$vitest_output_file" 2>/dev/null | sed 's/\x1b\[[0-9;]*m//g' | tail -2 || true)"
if [[ -n "$summary" ]]; then
  echo "$summary"
fi

if [[ -n "$slow_tests" ]]; then
  echo ""
  echo "Slow tests (>${SLOW_TEST_THRESHOLD_MS}ms):"
  echo "$slow_tests"
fi

echo "Integration tests completed in ${vitest_elapsed}s (budget: ${INTEGRATION_TIMEOUT_SECONDS}s)"

# Check for actual test failures (not just vitest worker crashes).
# Vitest can exit non-zero due to unhandled worker fork errors even when all tests pass.
has_test_failures="$(sed 's/\x1b\[[0-9;]*m//g' "$vitest_output_file" | grep -cE '[0-9]+ failed' || true)"
has_no_discovered_tests="$(sed 's/\x1b\[[0-9;]*m//g' "$vitest_output_file" | grep -cE 'Test Files[[:space:]]+no tests|Tests[[:space:]]+no tests' || true)"

if [[ "$has_test_failures" -gt 0 ]]; then
  echo "Integration tests failed"
  rm -f "$vitest_output_file"
  exit 1
fi

if [[ "$has_no_discovered_tests" -gt 0 ]]; then
  echo "Integration tests failed (no tests discovered)"
  rm -f "$vitest_output_file"
  exit 1
fi

if [[ "$vitest_exit" -ne 0 ]]; then
  echo "Integration tests completed with warnings (vitest exit=$vitest_exit, no test failures)"
fi

rm -f "$vitest_output_file"
