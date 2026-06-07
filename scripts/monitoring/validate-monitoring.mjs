// @ts-check
/**
 * Layer 1 - Offline, deterministic monitoring validation (the cheapest local proxy
 * for the GCP Cloud Monitoring alerts/dashboards).
 *
 * Two checks, both run via `promtool` (Prometheus' bundled linter/tester):
 *
 *   1. SYNTAX - every PromQL expression extracted from the alert + dashboard JSON is
 *      embedded into a Prometheus rules file and validated with `promtool check rules`.
 *      A malformed query fails the run with a clear message (and the offending file).
 *
 *   2. BEHAVIOUR - for each alert we synthesise a Prometheus alerting rule plus a
 *      `promtool test rules` fixture with two scenarios per alert:
 *        - "breach": input series chosen to cross the threshold → the alert MUST fire.
 *        - "healthy": input series safely inside SLO → the alert must stay silent.
 *      This proves each critical alert fires on exactly the right condition, fully
 *      offline, with no metric emission and no GCP.
 *
 * promtool is found via `command -v promtool`; if absent we fall back to the
 * `prom/prometheus` Docker image which bundles promtool. If neither is available the
 * script exits non-zero with install guidance.
 *
 * Pure Node.js, no npm deps.
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  extractAlertQueries,
  extractAllQueries,
  extractMetricNames
} from './extract-promql.mjs'

const PROM_IMAGE = 'prom/prometheus'

/**
 * @typedef {Object} PromtoolRunner
 * @property {(args: string[], files: Record<string, string>) => { status: number, stdout: string, stderr: string }} run
 *   Runs `promtool <args>`. `files` maps a logical filename to its contents; each is
 *   written into a shared temp dir and referenced by basename in `args`.
 * @property {string} description
 */

const commandExists = (cmd) => {
  const result = spawnSync('command', ['-v', cmd], { shell: '/bin/bash' })
  return result.status === 0
}

const dockerImageAvailable = () => {
  if (!commandExists('docker')) {
    return false
  }
  // Pull is implicit on first `docker run`; just confirm the daemon answers.
  const result = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'])
  return result.status === 0
}

/** @returns {PromtoolRunner | null} */
const resolveRunner = () => {
  if (commandExists('promtool')) {
    return {
      description: 'local promtool (on PATH)',
      run: (args, files) => {
        const dir = mkdtempSync(join(tmpdir(), 'promtool-'))
        try {
          for (const [name, contents] of Object.entries(files)) {
            writeFileSync(join(dir, name), contents)
          }
          const result = spawnSync('promtool', args, { cwd: dir, encoding: 'utf8' })
          return {
            status: result.status ?? 1,
            stdout: result.stdout ?? '',
            stderr: result.stderr ?? ''
          }
        } finally {
          rmSync(dir, { recursive: true, force: true })
        }
      }
    }
  }

  if (dockerImageAvailable()) {
    return {
      description: `docker (${PROM_IMAGE} bundled promtool)`,
      run: (args, files) => {
        const dir = mkdtempSync(join(tmpdir(), 'promtool-'))
        try {
          for (const [name, contents] of Object.entries(files)) {
            writeFileSync(join(dir, name), contents)
          }
          const result = spawnSync(
            'docker',
            [
              'run',
              '--rm',
              '-v',
              `${dir}:/work`,
              '-w',
              '/work',
              '--entrypoint',
              'promtool',
              PROM_IMAGE,
              ...args
            ],
            { encoding: 'utf8' }
          )
          return {
            status: result.status ?? 1,
            stdout: result.stdout ?? '',
            stderr: result.stderr ?? ''
          }
        } finally {
          rmSync(dir, { recursive: true, force: true })
        }
      }
    }
  }

  return null
}

/**
 * Strip Grafana/GMP dashboard template variables and `${env}`-style matchers so the
 * expression is valid standalone PromQL for syntax checking. Replaces the templated
 * regex value with `.*` (a benign, always-valid matcher value).
 * @param {string} query
 */
const sanitiseForSyntax = (query) =>
  query
    // `deployment_environment_name=~"${env}"` → `deployment_environment_name=~".*"`
    .replace(/=~"\$\{[^}]+\}"/gu, '=~".*"')
    .replace(/="\$\{[^}]+\}"/gu, '=".*"')
    // any stray `${var}` left in the body → 0 (defensive; none expected)
    .replace(/\$\{[^}]+\}/gu, '0')

/** YAML-escape a single-line scalar. */
const yamlString = (value) => `'${String(value).replace(/'/gu, "''")}'`

/**
 * Build a rules file containing every extracted query as a recording rule so
 * `promtool check rules` parses (and thus syntax-validates) each expression.
 * @param {ReturnType<typeof extractAllQueries>} queries
 */
const buildSyntaxRulesYaml = (queries) => {
  const rules = queries
    .map((q, index) => {
      const expr = sanitiseForSyntax(q.query)
      // Recording rule names must be valid metric names; index keeps them unique.
      const indented = expr
        .split('\n')
        .map((line) => `          ${line}`)
        .join('\n')
      return [
        `      - record: syntax_check_${index}`,
        `        expr: |`,
        indented
      ].join('\n')
    })
    .join('\n')

  return `groups:\n  - name: monitoring-syntax-check\n    rules:\n${rules}\n`
}

/**
 * Derive an alerting rule + synthetic breach/healthy fixtures from a single alert.
 * Returns null for alerts we cannot deterministically synthesise (e.g. `absent()`),
 * which are still syntax-checked but not behaviour-tested.
 *
 * @param {ReturnType<typeof extractAlertQueries>[number]} alert
 * @returns {{
 *   alertName: string,
 *   ruleYaml: string,
 *   breach: { input: string, fires: true },
 *   healthy: { input: string, fires: false }
 * } | null}
 */
const synthesiseAlertScenario = (alert) => {
  const expr = alert.query.trim()
  const alertName = alert.name
  const metrics = extractMetricNames(expr)

  // Helper to build a promtool `input_series` block.
  /**
   * @param {Array<{ series: string, values: string }>} series
   */
  const inputSeries = (series) =>
    series
      .map(
        (s) =>
          `      - series: ${yamlString(s.series)}\n        values: ${yamlString(s.values)}`
      )
      .join('\n')

  const ruleFor = (additional = '') =>
    [
      `  - name: ${alertName}-group`,
      `    rules:`,
      `      - alert: ${alertName}`,
      `        expr: |`,
      expr
        .split('\n')
        .map((line) => `          ${line}`)
        .join('\n'),
      additional
    ]
      .filter((line) => line.length > 0)
      .join('\n')

  // --- Ratio-style alert: (5xx / total) * 100 > N
  if (alertName === 'api_5xx_rate_critical') {
    // Counters: feed monotonically increasing series so rate() is positive.
    // api_5xx_rate_critical: 5xx fraction * 100 > 2
    const m = 'tx_agent_kit_api_request_total'
    return {
      alertName,
      ruleYaml: ruleFor(),
      breach: {
        // 10% 5xx → > 2% → fires
        input: inputSeries([
          { series: `${m}{status_class="5xx"}`, values: '0+1x15' },
          { series: `${m}{status_class="2xx"}`, values: '0+9x15' }
        ]),
        fires: true
      },
      healthy: {
        // ~0.5% 5xx → < 2% → silent
        input: inputSeries([
          { series: `${m}{status_class="5xx"}`, values: '0+1x15' },
          { series: `${m}{status_class="2xx"}`, values: '0+199x15' }
        ]),
        fires: false
      }
    }
  }

  if (alertName === 'outbox_listener_disconnected_critical') {
    const m = 'tx_agent_kit_outbox_listener_connected'
    return {
      alertName,
      ruleYaml: ruleFor(),
      breach: {
        input: inputSeries([{ series: m, values: '0x15' }]),
        fires: true
      },
      healthy: {
        input: inputSeries([{ series: m, values: '1x15' }]),
        fires: false
      }
    }
  }

  // --- Simple gauge threshold: metric > N  (single metric, no rate)
  if (
    alertName === 'outbox_depth_critical' ||
    alertName === 'outbox_age_critical' ||
    alertName === 'db_pool_connections_waiting_critical'
  ) {
    const m = metrics[0]
    if (!m) {
      return null
    }
    // Threshold is the numeric literal after the comparison operator.
    const thresholdMatch = expr.match(/>\s*([0-9]+(?:\.[0-9]+)?)/u)
    const threshold = thresholdMatch ? Number.parseFloat(thresholdMatch[1]) : 0
    const breachVal = threshold + Math.max(1, threshold)
    const healthyVal = threshold === 0 ? 0 : Math.floor(threshold / 2)
    return {
      alertName,
      ruleYaml: ruleFor(),
      breach: {
        input: inputSeries([{ series: m, values: `${breachVal}x15` }]),
        fires: true
      },
      healthy: {
        input: inputSeries([{ series: m, values: `${healthyVal}x15` }]),
        fires: false
      }
    }
  }

  // --- Ratio of two gauges: used/max > 0.9
  if (alertName === 'db_pool_utilisation_critical') {
    return {
      alertName,
      ruleYaml: ruleFor(),
      breach: {
        // 19/20 = 0.95 > 0.9 → fires
        input: inputSeries([
          { series: `tx_agent_kit_db_pool_connections_total`, values: '19x15' },
          { series: `tx_agent_kit_db_pool_max`, values: '20x15' }
        ]),
        fires: true
      },
      healthy: {
        // 5/20 = 0.25 → silent
        input: inputSeries([
          { series: `tx_agent_kit_db_pool_connections_total`, values: '5x15' },
          { series: `tx_agent_kit_db_pool_max`, values: '20x15' }
        ]),
        fires: false
      }
    }
  }

  // --- rate(counter)[> T]  optionally scaled by a constant multiplier `* M`.
  // Covers `sum(rate(m[5m])) * 60 > N` (events/min) and `sum(rate(m[5m])) > N`.
  if (
    alertName === 'temporal_workflow_failure_critical' ||
    alertName === 'auth_rate_limit_spike_warning'
  ) {
    const m = metrics[0]
    if (!m) {
      return null
    }
    // Parse threshold and any `* <multiplier>` scale so the breach slope clears it
    // regardless of how the alert is currently written (the alerts agent tunes both).
    const thresholdMatch = expr.match(/>\s*([0-9]+(?:\.[0-9]+)?)/u)
    const threshold = thresholdMatch ? Number.parseFloat(thresholdMatch[1]) : 0
    const multiplierMatch = expr.match(/\*\s*([0-9]+(?:\.[0-9]+)?)/u)
    const multiplier = multiplierMatch ? Number.parseFloat(multiplierMatch[1]) : 1
    // Steady-state value = (perMinuteStep / 60) * multiplier. Solve for a step that
    // sits comfortably (3x) above the threshold; floor at 60 so rate() is meaningful.
    const requiredStep = (threshold * 60) / Math.max(multiplier, 1e-9)
    const breachStep = Math.max(60, Math.ceil(requiredStep * 3))
    return {
      alertName,
      ruleYaml: ruleFor(),
      breach: {
        // steep increase → per-second rate well above threshold → fires
        input: inputSeries([{ series: m, values: `0+${breachStep}x15` }]),
        fires: true
      },
      healthy: {
        // flat counter → rate 0 → silent
        input: inputSeries([{ series: m, values: '5x15' }]),
        fires: false
      }
    }
  }

  // --- histogram_quantile(0.95, ...) > N  (latency/lag percentile thresholds)
  if (alertName === 'temporal_schedule_to_start_critical') {
    const bucketMetric = metrics.find((name) => name.endsWith('_bucket'))
    if (!bucketMetric) {
      return null
    }
    const thresholdMatch = expr.match(/>\s*([0-9]+(?:\.[0-9]+)?)/u)
    const threshold = thresholdMatch ? Number.parseFloat(thresholdMatch[1]) : 0
    // Put all observations above the threshold so p95 exceeds it. Classic Prometheus
    // histogram: cumulative buckets. We size le buckets around the threshold.
    const lowLe = threshold / 2
    const highLe = threshold * 2
    const breach = inputSeries([
      // All samples land in the high bucket → p95 ≈ between lowLe and highLe, > threshold.
      { series: `${bucketMetric}{le="${lowLe}"}`, values: '0+0x15' },
      { series: `${bucketMetric}{le="${highLe}"}`, values: '0+100x15' },
      { series: `${bucketMetric}{le="+Inf"}`, values: '0+100x15' }
    ])
    const healthy = inputSeries([
      // All samples land in the low bucket → p95 ≈ lowLe < threshold.
      { series: `${bucketMetric}{le="${lowLe}"}`, values: '0+100x15' },
      { series: `${bucketMetric}{le="${highLe}"}`, values: '0+100x15' },
      { series: `${bucketMetric}{le="+Inf"}`, values: '0+100x15' }
    ])
    return {
      alertName,
      ruleYaml: ruleFor(),
      breach: { input: breach, fires: true },
      healthy: { input: healthy, fires: false }
    }
  }

  // absent(...) and anything else: syntax-checked only, no behaviour fixture.
  return null
}

/**
 * Build a `promtool test rules` test file for one scenario.
 * @param {string} alertName
 * @param {string} inputSeries  YAML for input_series entries (already indented)
 * @param {boolean} shouldFire
 * @param {string} durationSeconds  e.g. "900s"; promtool eval at the alert's `for`.
 */
const buildTestFile = (rulesFileName, alertName, inputSeries, shouldFire) => {
  // Evaluate after enough steps for rate()/increase() windows (we feed 16 points @1m).
  const evalTime = '15m'
  const alertAssertion = shouldFire
    ? `        exp_alerts:\n          - {}`
    : `        exp_alerts: []`
  return [
    `rule_files:`,
    `  - ${rulesFileName}`,
    `evaluation_interval: 1m`,
    `tests:`,
    `  - interval: 1m`,
    `    input_series:`,
    inputSeries,
    `    alert_rule_test:`,
    `      - eval_time: ${evalTime}`,
    `        alertname: ${alertName}`,
    alertAssertion
  ].join('\n')
}

const main = () => {
  const runner = resolveRunner()
  if (!runner) {
    process.stderr.write(
      [
        'ERROR: neither `promtool` nor a usable Docker daemon was found.',
        'Install one of:',
        '  - promtool: `brew install prometheus` (bundles promtool)',
        '  - Docker:   start Docker Desktop (uses the prom/prometheus image)',
        ''
      ].join('\n')
    )
    process.exit(2)
  }

  process.stdout.write(`Monitoring validation (Layer 1) - using ${runner.description}\n\n`)

  const allQueries = extractAllQueries()
  const alertQueries = extractAlertQueries()

  // -------------------------------------------------------------------------
  // Check 1: PromQL syntax for every alert + dashboard query.
  // -------------------------------------------------------------------------
  process.stdout.write(
    `[1/2] Syntax-checking ${allQueries.length} PromQL expressions...\n`
  )
  const syntaxYaml = buildSyntaxRulesYaml(allQueries)
  const syntaxResult = runner.run(['check', 'rules', 'syntax.rules.yml'], {
    'syntax.rules.yml': syntaxYaml
  })

  let syntaxOk = syntaxResult.status === 0
  if (!syntaxOk) {
    process.stdout.write('  FAIL - one or more PromQL expressions are malformed:\n')
    process.stdout.write(indent(syntaxResult.stdout))
    process.stdout.write(indent(syntaxResult.stderr))
    // Best-effort: map promtool's reported rule index back to source files.
    const offending = [...syntaxResult.stdout.matchAll(/syntax_check_(\d+)/gu)].map(
      (match) => Number.parseInt(match[1], 10)
    )
    for (const idx of new Set(offending)) {
      const q = allQueries[idx]
      if (q) {
        process.stdout.write(
          `    -> ${q.source} ${q.name}\n       ${q.file}\n       ${q.query.replace(/\n/gu, ' ')}\n`
        )
      }
    }
  } else {
    process.stdout.write('  OK - all expressions parse.\n')
  }

  // -------------------------------------------------------------------------
  // Check 2: behaviour test each alert (breach fires, healthy stays silent).
  // -------------------------------------------------------------------------
  process.stdout.write(`\n[2/2] Behaviour-testing ${alertQueries.length} alerts...\n`)

  /** @type {Array<{ name: string, status: 'pass' | 'fail' | 'syntax-only', detail?: string }>} */
  const alertResults = []

  for (const alert of alertQueries) {
    const scenario = synthesiseAlertScenario(alert)
    if (!scenario) {
      alertResults.push({
        name: alert.name,
        status: 'syntax-only',
        detail: 'no deterministic synthetic fixture (e.g. absent()) - syntax checked only'
      })
      continue
    }

    const rulesFileName = `${scenario.alertName}.rules.yml`
    const rulesYaml = `groups:\n${scenario.ruleYaml}\n`

    const breachTest = buildTestFile(
      rulesFileName,
      scenario.alertName,
      scenario.breach.input,
      true
    )
    const healthyTest = buildTestFile(
      rulesFileName,
      scenario.alertName,
      scenario.healthy.input,
      false
    )

    const breachRun = runner.run(['test', 'rules', 'breach.test.yml'], {
      [rulesFileName]: rulesYaml,
      'breach.test.yml': breachTest
    })
    const healthyRun = runner.run(['test', 'rules', 'healthy.test.yml'], {
      [rulesFileName]: rulesYaml,
      'healthy.test.yml': healthyTest
    })

    const passed = breachRun.status === 0 && healthyRun.status === 0
    if (passed) {
      alertResults.push({ name: scenario.alertName, status: 'pass' })
    } else {
      const detail = [
        breachRun.status !== 0 ? `breach scenario did not fire:\n${breachRun.stdout}${breachRun.stderr}` : '',
        healthyRun.status !== 0 ? `healthy scenario fired unexpectedly:\n${healthyRun.stdout}${healthyRun.stderr}` : ''
      ]
        .filter((line) => line.length > 0)
        .join('\n')
      alertResults.push({ name: scenario.alertName, status: 'fail', detail })
    }
  }

  for (const result of alertResults) {
    const tag =
      result.status === 'pass'
        ? 'PASS'
        : result.status === 'syntax-only'
          ? 'SKIP'
          : 'FAIL'
    process.stdout.write(`  [${tag}] ${result.name}\n`)
    if (result.detail && result.status === 'fail') {
      process.stdout.write(indent(result.detail))
    }
    if (result.detail && result.status === 'syntax-only') {
      process.stdout.write(`        (${result.detail})\n`)
    }
  }

  const behaviourFailed = alertResults.some((r) => r.status === 'fail')

  process.stdout.write('\nSummary:\n')
  process.stdout.write(`  syntax:    ${syntaxOk ? 'OK' : 'FAIL'}\n`)
  process.stdout.write(
    `  behaviour: ${alertResults.filter((r) => r.status === 'pass').length} pass, ` +
      `${alertResults.filter((r) => r.status === 'fail').length} fail, ` +
      `${alertResults.filter((r) => r.status === 'syntax-only').length} syntax-only\n`
  )

  process.exit(!syntaxOk || behaviourFailed ? 1 : 0)
}

const indent = (text) =>
  text
    .split('\n')
    .map((line) => (line.length > 0 ? `        ${line}` : line))
    .join('\n') + (text.endsWith('\n') ? '' : '\n')

main()
