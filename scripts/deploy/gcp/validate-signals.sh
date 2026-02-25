#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
source "$SCRIPT_DIR/lib.sh"

require_guard
require_tool gcloud
require_tool node

if [[ $# -gt 1 ]]; then
  echo "Usage: $0 [project-id]"
  exit 1
fi

if [[ $# -eq 1 ]]; then
  GCP_PROJECT_ID="$1"
fi
require_env GCP_PROJECT_ID

SMOKE_SERVICE_NAME="${SMOKE_SERVICE_NAME:-tx-agent-kit-gcp-e2e}"
SMOKE_LOG_MARKER="${SMOKE_LOG_MARKER:-observability.smoke.log}"
VALIDATION_TIMEOUT_SECONDS="${VALIDATION_TIMEOUT_SECONDS:-300}"
VALIDATION_POLL_SECONDS="${VALIDATION_POLL_SECONDS:-10}"

ACCESS_TOKEN="$(gcloud auth print-access-token)"

ACCESS_TOKEN="$ACCESS_TOKEN" \
GCP_PROJECT_ID="$GCP_PROJECT_ID" \
SMOKE_SERVICE_NAME="$SMOKE_SERVICE_NAME" \
SMOKE_LOG_MARKER="$SMOKE_LOG_MARKER" \
VALIDATION_TIMEOUT_SECONDS="$VALIDATION_TIMEOUT_SECONDS" \
VALIDATION_POLL_SECONDS="$VALIDATION_POLL_SECONDS" \
node <<'NODE'
const accessToken = process.env.ACCESS_TOKEN
const projectId = process.env.GCP_PROJECT_ID
const smokeServiceName = process.env.SMOKE_SERVICE_NAME
const smokeLogMarker = process.env.SMOKE_LOG_MARKER
const timeoutSeconds = Number.parseInt(process.env.VALIDATION_TIMEOUT_SECONDS ?? '300', 10)
const pollSeconds = Number.parseInt(process.env.VALIDATION_POLL_SECONDS ?? '10', 10)

if (!accessToken || !projectId || !smokeServiceName || !smokeLogMarker) {
  throw new Error('Missing validation environment variables.')
}

const headers = {
  Authorization: `Bearer ${accessToken}`,
  'Content-Type': 'application/json'
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const fetchJson = async (url, init, options = {}) => {
  const { allowNotFound = false } = options
  const response = await fetch(url, init)
  if (!response.ok) {
    const body = await response.text()

    if (allowNotFound && response.status === 404) {
      return { __notFound: true }
    }

    throw new Error(`Request failed (${response.status}) ${url}: ${body}`)
  }

  return response.json()
}

const isoWindowStart = () => new Date(Date.now() - 30 * 60 * 1000).toISOString()
const isoWindowEnd = () => new Date().toISOString()

const hasTrace = async () => {
  const queryUrl = new URL(`https://cloudtrace.googleapis.com/v1/projects/${projectId}/traces`)
  queryUrl.searchParams.set('filter', '+span:observability.smoke.node')
  queryUrl.searchParams.set('view', 'COMPLETE')
  queryUrl.searchParams.set('pageSize', '20')

  const payload = await fetchJson(queryUrl.toString(), { headers })
  const traces = Array.isArray(payload.traces) ? payload.traces : []
  if (traces.length === 0) {
    return false
  }

  const raw = JSON.stringify(traces)
  return raw.includes(smokeServiceName)
}

const hasMetric = async () => {
  const candidates = [
    'workload.googleapis.com/tx_agent_kit_node_service_startup_total'
  ]

  for (const metricType of candidates) {
    const filter = `metric.type=\"${metricType}\" AND metric.labels.smoke_service=\"${smokeServiceName}\"`
    const queryUrl = new URL(`https://monitoring.googleapis.com/v3/projects/${projectId}/timeSeries`)
    queryUrl.searchParams.set('filter', filter)
    queryUrl.searchParams.set('interval.startTime', isoWindowStart())
    queryUrl.searchParams.set('interval.endTime', isoWindowEnd())
    queryUrl.searchParams.set('view', 'HEADERS')
    queryUrl.searchParams.set('pageSize', '5')

    const payload = await fetchJson(queryUrl.toString(), { headers }, { allowNotFound: true })
    if (payload.__notFound) {
      continue
    }

    if (Array.isArray(payload.timeSeries) && payload.timeSeries.length > 0) {
      return true
    }
  }

  return false
}

const hasLog = async () => {
  const payload = await fetchJson('https://logging.googleapis.com/v2/entries:list', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      resourceNames: [`projects/${projectId}`],
      filter: `timestamp >= \"${isoWindowStart()}\" AND SEARCH(\"${smokeLogMarker}\")`,
      pageSize: 20
    })
  })

  const entries = Array.isArray(payload.entries) ? payload.entries : []
  if (entries.length === 0) {
    return false
  }

  const raw = JSON.stringify(entries)
  return raw.includes(smokeLogMarker)
}

const deadline = Date.now() + timeoutSeconds * 1000
let lastTraceError = 'not checked'
let lastMetricError = 'not checked'
let lastLogError = 'not checked'

while (Date.now() < deadline) {
  let traceOk = false
  let metricOk = false
  let logOk = false

  try {
    traceOk = await hasTrace()
    lastTraceError = traceOk ? 'ok' : 'trace marker not found yet'
  } catch (error) {
    lastTraceError = error instanceof Error ? error.message : String(error)
  }

  try {
    metricOk = await hasMetric()
    lastMetricError = metricOk ? 'ok' : 'metric series not found yet'
  } catch (error) {
    lastMetricError = error instanceof Error ? error.message : String(error)
  }

  try {
    logOk = await hasLog()
    lastLogError = logOk ? 'ok' : 'log marker not found yet'
  } catch (error) {
    lastLogError = error instanceof Error ? error.message : String(error)
  }

  if (traceOk && metricOk && logOk) {
    process.stdout.write('Validated traces + metrics + logs in GCP.\n')
    process.exit(0)
  }

  await delay(pollSeconds * 1000)
}

throw new Error(
  [
    'Timed out validating GCP telemetry signals.',
    `Trace status: ${lastTraceError}`,
    `Metric status: ${lastMetricError}`,
    `Log status: ${lastLogError}`
  ].join('\n')
)
NODE

echo "GCP telemetry validation complete for project $GCP_PROJECT_ID"
