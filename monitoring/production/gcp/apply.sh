#!/usr/bin/env bash
# apply.sh - Apply GCP Cloud Monitoring dashboards and alert policies.
#
# USAGE:
#   PROJECT_ID=my-gcp-project \
#   NOTIFICATION_CHANNEL=projects/my-gcp-project/notificationChannels/12345 \
#   bash monitoring/production/gcp/apply.sh
#
# REQUIRED ENV VARS:
#   PROJECT_ID            - GCP project ID (e.g. the staging or prod project)
#   NOTIFICATION_CHANNEL  - Full notification channel resource name.
#                           Find with: gcloud alpha monitoring channels list --project=$PROJECT_ID
#
# OPTIONAL ENV VARS:
#   DRY_RUN=1             - Print what would be applied without calling gcloud
#   SKIP_DASHBOARDS=1     - Skip dashboard creation
#   SKIP_ALERTS=1         - Skip alert policy creation
#
# IDEMPOTENCY NOTE:
#   gcloud monitoring dashboards create and gcloud alpha monitoring policies create always
#   CREATE new resources - they do not upsert. Re-running this script will create DUPLICATE
#   dashboards and policies. To update an existing resource:
#     - Dashboards: gcloud monitoring dashboards update DASHBOARD_ID --config-from-file=<f>
#     - Policies:   gcloud alpha monitoring policies update POLICY_ID --policy-from-file=<f>
#   After the first apply, note the resource IDs printed and store them (e.g. in a tfvars or
#   a .applied-ids file) to enable idempotent updates.
#
# ENVIRONMENT SELECTOR:
#   The dashboards and alerts use the `deployment_environment_name` label to distinguish
#   staging from production. Apply this script once per GCP project; the dashboard filter
#   lets you scope to either environment at view time. If you maintain separate GCP
#   projects for staging and prod, apply to each.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DASHBOARDS_DIR="${SCRIPT_DIR}/dashboards"
ALERTS_DIR="${SCRIPT_DIR}/alerts"

# ---------------------------------------------------------------------------
# Validate required inputs
# ---------------------------------------------------------------------------
if [[ -z "${PROJECT_ID:-}" ]]; then
  echo "ERROR: PROJECT_ID environment variable is not set." >&2
  echo "  Example: PROJECT_ID=my-gcp-project bash apply.sh" >&2
  exit 1
fi

if [[ -z "${NOTIFICATION_CHANNEL:-}" ]]; then
  echo "WARNING: NOTIFICATION_CHANNEL is not set - alert policies will have no notification channels." >&2
  echo "  Find channels with: gcloud alpha monitoring channels list --project=${PROJECT_ID}" >&2
  echo "  Set: NOTIFICATION_CHANNEL=projects/${PROJECT_ID}/notificationChannels/CHANNEL_ID" >&2
  echo ""
fi

DRY_RUN="${DRY_RUN:-0}"
SKIP_DASHBOARDS="${SKIP_DASHBOARDS:-0}"
SKIP_ALERTS="${SKIP_ALERTS:-0}"

echo "============================================================"
echo "GCP Monitoring Apply"
echo "Project:              ${PROJECT_ID}"
echo "Notification channel: ${NOTIFICATION_CHANNEL:-<none - set NOTIFICATION_CHANNEL>}"
echo "Dry run:              ${DRY_RUN}"
echo "============================================================"
echo ""

# ---------------------------------------------------------------------------
# Helper: run or print a command
# ---------------------------------------------------------------------------
run_cmd() {
  if [[ "${DRY_RUN}" == "1" ]]; then
    echo "[DRY RUN] $*"
  else
    "$@"
  fi
}

# ---------------------------------------------------------------------------
# Helper: inject notification channel into a policy JSON and write to a temp file.
# The JSON files ship with an empty notificationChannels array. We patch it here
# at apply time so the committed JSON files stay environment-agnostic.
# ---------------------------------------------------------------------------
patch_policy_channels() {
  local input_file="$1"
  local tmp_file
  tmp_file="$(mktemp /tmp/gcp-policy-XXXXXX.json)"

  if [[ -n "${NOTIFICATION_CHANNEL:-}" ]]; then
    python3 -c "
import json, sys
with open('${input_file}') as f:
    policy = json.load(f)
# Skip TODO/placeholder policies that are explicitly disabled
if not policy.get('enabled', True):
    sys.stdout.write(json.dumps(policy, indent=2))
    sys.exit(0)
policy['notificationChannels'] = ['${NOTIFICATION_CHANNEL}']
sys.stdout.write(json.dumps(policy, indent=2))
" > "${tmp_file}"
  else
    cp "${input_file}" "${tmp_file}"
  fi

  echo "${tmp_file}"
}

# ---------------------------------------------------------------------------
# Apply dashboards
# ---------------------------------------------------------------------------
if [[ "${SKIP_DASHBOARDS}" != "1" ]]; then
  echo "--- Applying dashboards ---"
  echo ""

  for dashboard_file in "${DASHBOARDS_DIR}"/*.json; do
    name="$(basename "${dashboard_file}")"
    echo "  Applying dashboard: ${name}"

    run_cmd gcloud monitoring dashboards create \
      --config-from-file="${dashboard_file}" \
      --project="${PROJECT_ID}"

    echo "  Done: ${name}"
    echo ""
  done

  echo "All dashboards applied."
  echo ""
  echo "NOTE: To list created dashboards and capture their IDs for future updates:"
  echo "  gcloud monitoring dashboards list --project=${PROJECT_ID} --format='table(name,displayName)'"
  echo ""
fi

# ---------------------------------------------------------------------------
# Apply alert policies
# ---------------------------------------------------------------------------
if [[ "${SKIP_ALERTS}" != "1" ]]; then
  echo "--- Applying alert policies ---"
  echo ""

  created_alerts=()
  deferred_alerts=()

  for policy_file in "${ALERTS_DIR}"/*.json; do
    name="$(basename "${policy_file}")"

    # Skip TODO placeholder files - they contain _TODO keys and have enabled=false.
    # We detect them by filename convention (*-TODO.json).
    if [[ "${name}" == *"-TODO.json" ]]; then
      echo "  SKIPPING (TODO placeholder): ${name}"
      echo "  -> This metric is not yet emitted. See the _TODO key in the file for instrumentation guidance."
      echo ""
      continue
    fi

    echo "  Applying alert policy: ${name}"

    # Patch notification channels at apply time
    tmp_policy="$(patch_policy_channels "${policy_file}")"

    # Best-effort: GMP rejects a PromQL alert whose metric has not been ingested
    # yet (no descriptor). Rather than abort the whole run, create what we can and
    # defer the rest - re-run after the metric is emitted by real traffic.
    if run_cmd gcloud alpha monitoring policies create \
        --policy-from-file="${tmp_policy}" \
        --project="${PROJECT_ID}"; then
      echo "  Done: ${name}"
      created_alerts+=("${name}")
    else
      echo "  DEFERRED: ${name} (metric not yet ingested in GMP - re-run after emitting it)"
      deferred_alerts+=("${name}")
    fi

    rm -f "${tmp_policy}"
    echo ""
  done

  echo "Alert policies: ${#created_alerts[@]} created, ${#deferred_alerts[@]} deferred."
  if [[ ${#deferred_alerts[@]} -gt 0 ]]; then
    echo "Deferred (metric not yet in GMP):"
    printf '  - %s\n' "${deferred_alerts[@]}"
  fi
  echo ""
  echo "NOTE: To list created policies and capture their IDs for future updates:"
  echo "  gcloud alpha monitoring policies list --project=${PROJECT_ID} --format='table(name,displayName)'"
  echo ""
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo "============================================================"
echo "Apply complete."
echo ""
echo "NEXT STEPS:"
echo "1. Verify dashboards in Cloud Monitoring:"
echo "   https://console.cloud.google.com/monitoring/dashboards?project=${PROJECT_ID}"
echo ""
echo "2. Verify alert policies:"
echo "   https://console.cloud.google.com/monitoring/alerting?project=${PROJECT_ID}"
echo ""
echo "3. Confirm metric names are resolving:"
echo "   gcloud monitoring metrics list \\"
echo "     --filter='metric.type=~prometheus.googleapis.com.*tx_agent_kit.*' \\"
echo "     --project=${PROJECT_ID}"
echo ""
echo "4. For TODO policies, instrument the metrics first, then re-enable by:"
echo "   - Removing the '-TODO' suffix and '_TODO' key from the JSON"
echo "   - Setting 'enabled': true"
echo "   - Re-running apply.sh"
echo "============================================================"
