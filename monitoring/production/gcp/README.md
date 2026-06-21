# tx-agent-kit - GCP Cloud Monitoring

Committed JSON definitions for Cloud Monitoring dashboards and alert policies,
plus an `apply.sh` script to provision them via `gcloud`.

## Directory structure

```
monitoring/production/gcp/
|-- dashboards/
|   |-- resource-usage.json         # Per-container + host (VM) CPU/RAM/load/filesystem
|   `-- api-slo.json                # Request rate, latency p50/p95/p99, 5xx error rate
|-- alerts/
|   |-- critical-api-5xx-rate.json
|   |-- critical-db-pool-exhausted.json
|   |-- critical-metric-ingestion-absence.json
|   |-- critical-no-active-workers.json
|   |-- critical-outbox-age.json
|   |-- critical-outbox-depth.json
|   |-- critical-outbox-dispatcher-stale.json
|   |-- critical-outbox-listener-disconnected.json
|   |-- critical-outbox-wedged.json
|   |-- critical-temporal-schedule-to-start.json
|   |-- critical-temporal-workflow-failure.json
|   |-- warning-api-memory-high.json
|   |-- warning-host-cpu-high.json
|   |-- warning-host-memory-high.json
|   |-- warning-outbox-poller-saturation.json
|   |-- warning-rate-limit-spike.json
|   |-- warning-request-validation-spike.json
|   `-- warning-worker-memory-high.json
|-- apply.sh
`-- README.md
```

## Usage

### Prerequisites

- `gcloud` CLI authenticated with a principal that has the following IAM roles on the target project:
  - `roles/monitoring.dashboardEditor`
  - `roles/monitoring.alertPolicyEditor`
- `python3` available in PATH (used by `apply.sh` to patch notification channels at apply time).

### Apply to a project

```bash
# Dry run first (prints commands, does not call gcloud)
PROJECT_ID=my-gcp-project \
NOTIFICATION_CHANNEL=projects/my-gcp-project/notificationChannels/12345 \
DRY_RUN=1 \
bash monitoring/production/gcp/apply.sh

# Live apply
PROJECT_ID=my-gcp-project \
NOTIFICATION_CHANNEL=projects/my-gcp-project/notificationChannels/12345 \
bash monitoring/production/gcp/apply.sh
```

Find your notification channel IDs with:
```bash
gcloud alpha monitoring channels list --project=my-gcp-project
```

### Partial apply

```bash
# Dashboards only
SKIP_ALERTS=1 PROJECT_ID=... bash monitoring/production/gcp/apply.sh

# Alert policies only
SKIP_DASHBOARDS=1 PROJECT_ID=... bash monitoring/production/gcp/apply.sh
```

### Idempotency

`gcloud monitoring dashboards create` and `gcloud alpha monitoring policies create` always
**create new resources**; they do not upsert. Re-running `apply.sh` will create duplicates.

After the first apply, capture the resource IDs:
```bash
# Dashboards
gcloud monitoring dashboards list \
  --project=my-gcp-project \
  --format='table(name,displayName)'

# Alert policies
gcloud alpha monitoring policies list \
  --project=my-gcp-project \
  --format='table(name,displayName)'
```

Use the `name` field (e.g. `projects/my-gcp-project/dashboards/abc123`) to update:
```bash
gcloud monitoring dashboards update projects/my-gcp-project/dashboards/abc123 \
  --config-from-file=dashboards/api-slo.json

gcloud alpha monitoring policies update projects/my-gcp-project/alertPolicies/xyz456 \
  --policy-from-file=alerts/critical-api-5xx-rate.json
```

## Metric namespace (GMP / PromQL)

All custom metrics are scraped by the OTEL Collector and forwarded to
**Google Managed Service for Prometheus (GMP)**. When queried via PromQL in Cloud
Monitoring dashboards or alert conditions, the metrics are referenced by their **bare
instrument names** (e.g. `tx_agent_kit_api_request_total`). GMP resolves these
automatically when PromQL mode is active.

> **Important:** In the Cloud Monitoring metric browser or MQL, these same metrics
> appear under the `prometheus.googleapis.com/` prefix
> (e.g. `prometheus.googleapis.com/tx_agent_kit_api_request_total/counter`).
> In PromQL queries (dashboards, alert policies using `conditionPrometheusQueryLanguage`),
> use the **bare name without prefix**.

### OTEL to Prometheus name rendering rules

The OTEL/Prometheus exporter transforms instrument names. Apply these rules when writing PromQL:

| Instrument type | Rule | Example |
|----------------|------|---------|
| Counter | Keep `_total` suffix | `tx_agent_kit_api_request_total` |
| Histogram (ms) | Add `_milliseconds_{bucket,count,sum}` | `tx_agent_kit_api_request_duration_milliseconds_bucket` |
| Histogram (s) | Add `_seconds_{bucket,count,sum}` | `..._seconds_bucket` |
| Gauge | Name as-is | `tx_agent_kit_outbox_unprocessed_count` |

> Run `curl -s 'http://localhost:9090/api/v1/label/__name__/values' | tr ',' '\n' | grep tx_agent_kit`
> to validate the rendered names locally once traffic flows.

### Verify metric ingestion

```bash
gcloud monitoring metrics list \
  --filter='metric.type=~prometheus.googleapis.com.*tx_agent_kit.*' \
  --project=my-gcp-project
```

If no results, check:
1. OTEL Collector is running and scraping the API and worker.
2. GMP is enabled on the project: `gcloud services enable monitoring.googleapis.com`.
3. The workload identity / service account has `roles/monitoring.metricWriter`.

## Staging vs prod selector

All dashboards include a `deployment_environment_name` filter (top of each dashboard).
Set it to the staging or prod environment value. The `deployment_environment_name`
label is set by the OTEL Collector via a resource attribute processor in the collector
configuration. Alert policies do **not** filter by environment by default - they fire
on any matching time series across the project. If you need per-environment alert
policies, duplicate the alert JSON and add a label selector to the PromQL query, e.g.:

```promql
sum(rate(tx_agent_kit_api_request_total{deployment_environment_name="prod"}[5m]))
```

## Validation

The PromQL in every alert and dashboard JSON is validated offline (syntax + behaviour)
via `promtool`:

```bash
pnpm monitoring:validate
```

See `scripts/monitoring/README.md` for details.
