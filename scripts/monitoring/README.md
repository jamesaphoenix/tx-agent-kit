# Monitoring validation

The cheapest possible **local** validation that the production GCP Cloud Monitoring
dashboards and alert policies actually work - i.e. their PromQL is syntactically valid
**and** the metric names match what really lands in Prometheus - using fake metrics, no
GCP.

The source of truth is the GCP JSON under `monitoring/production/gcp/`:

- `alerts/*.json` - alert policies (`conditionPrometheusQueryLanguage`)
- `dashboards/*.json` - dashboard tiles (`prometheusQuery`)

Files named `*-TODO.json` are skipped (placeholders, not yet wired).

---

## Offline, deterministic alert-rule tests (primary, cheapest)

```bash
pnpm monitoring:validate
# or directly:
node scripts/monitoring/validate-monitoring.mjs
```

Runs fully **offline** (no infra, no metric emission, no GCP). It:

1. **Syntax-checks** every PromQL expression extracted from the alert + dashboard JSON
   by embedding them into a Prometheus rules file and running `promtool check rules`.
   A malformed query fails the run and points at the offending file/expression.
2. **Behaviour-tests** each alert: generates a Prometheus alerting rule plus a
   `promtool test rules` fixture with two synthetic scenarios per alert -
   - a **breach** scenario whose input series cross the threshold -> the alert MUST fire;
   - a **healthy** scenario safely inside SLO -> the alert must stay silent.

   This deterministically proves each critical alert fires on the right condition.

Alerts whose condition cannot be deterministically synthesised on fake series (e.g.
`absent(...)` / no-data alerts) are reported as `SKIP` (syntax-checked only).

The extractor (`extract-promql.mjs`) is **generic** - driven by the JSON shape, not a
hardcoded query list - so it stays correct as alerts/dashboards change. Run it standalone
to dump everything it finds:

```bash
node scripts/monitoring/extract-promql.mjs
```

### Requirements

`promtool` (Prometheus' bundled linter/tester). The validator finds it via:

- `promtool` on `PATH` - `brew install prometheus` (bundles `promtool`); or
- the `prom/prometheus` Docker image (bundles `promtool`) - just have Docker running.

If neither is available the script exits non-zero with install guidance.

### Rendered-name rules (OTEL -> Prometheus exporter)

- counters keep `_total`;
- histograms expand their UCUM unit (`ms` -> `_milliseconds`, `s` -> `_seconds`) and
  fan out to `_bucket` / `_count` / `_sum`;
- gauges keep their instrument name as-is.

> **Local vs GMP:** the local OTEL-collector pipeline expands histogram units (e.g.
> `tx_agent_kit_api_request_duration_milliseconds_bucket`). Google Managed Prometheus
> (GMP) may render the same instruments without the unit suffix. The offline validator
> asserts the **committed** PromQL names; the **GMP-rendered** names are confirmed the
> same way on staging via `gcloud monitoring metrics list`.

---

## Why this exists

This is the cheapest local proxy for the GCP alerts: it proves the alert logic offline
and deterministically, and catches PromQL syntax errors and obvious metric-name drift
before anything is applied to a real project.
