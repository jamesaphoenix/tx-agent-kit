// @ts-check
/**
 * Generic PromQL extractor for the GCP Cloud Monitoring JSON in
 * `monitoring/production/gcp/{alerts,dashboards}/*.json`.
 *
 * It is driven entirely by the JSON shape (no hardcoded query lists) so it stays
 * correct as alerts/dashboards change:
 *  - Alert conditions expose PromQL under
 *    `conditions[].conditionPrometheusQueryLanguage.query` (+ `alertRule`, `duration`).
 *  - Dashboard tiles expose PromQL under any nested `prometheusQuery` string.
 *
 * Files named `*-TODO.json` are skipped (placeholders, not yet wired).
 *
 * No external deps - pure Node.js so it runs offline.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const repoRoot = resolve(here, '..', '..')
export const alertsDir = join(repoRoot, 'monitoring', 'production', 'gcp', 'alerts')
export const dashboardsDir = join(
  repoRoot,
  'monitoring',
  'production',
  'gcp',
  'dashboards'
)

/**
 * @typedef {Object} ExtractedQuery
 * @property {'alert' | 'dashboard'} source
 * @property {string} file        absolute path to the JSON file
 * @property {string} name        alertRule (alerts) or tile/display label (dashboards)
 * @property {string} query       raw PromQL expression
 * @property {string} [durationSeconds] alert `duration` (e.g. "900s"), alerts only
 */

const isTodoFile = (fileName) => /-TODO\.json$/u.test(fileName)
const isJsonFile = (fileName) => fileName.endsWith('.json')

const listJsonFiles = (dir) => {
  let entries = []
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  return entries
    .filter((name) => isJsonFile(name) && !isTodoFile(name))
    .sort()
    .map((name) => join(dir, name))
}

const parseJsonFile = (file) => {
  const raw = readFileSync(file, 'utf8')
  return JSON.parse(raw)
}

/**
 * Walk an arbitrary object tree collecting every string value under a given key.
 * @param {unknown} node
 * @param {string} key
 * @param {string[]} out
 */
const collectStringsForKey = (node, key, out) => {
  if (Array.isArray(node)) {
    for (const item of node) {
      collectStringsForKey(item, key, out)
    }
    return
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === key && typeof v === 'string') {
        out.push(v)
      } else {
        collectStringsForKey(v, key, out)
      }
    }
  }
}

/**
 * Walk a dashboard tree, pairing each `prometheusQuery` with the nearest enclosing
 * widget `title` for a human-readable name.
 * @param {unknown} node
 * @param {string} inheritedTitle
 * @param {Array<{ title: string, query: string }>} out
 */
const collectDashboardQueries = (node, inheritedTitle, out) => {
  if (Array.isArray(node)) {
    for (const item of node) {
      collectDashboardQueries(item, inheritedTitle, out)
    }
    return
  }
  if (!node || typeof node !== 'object') {
    return
  }
  const record = /** @type {Record<string, unknown>} */ (node)
  const title =
    typeof record.title === 'string' && record.title.length > 0
      ? record.title
      : inheritedTitle
  for (const [k, v] of Object.entries(record)) {
    if (k === 'prometheusQuery' && typeof v === 'string') {
      out.push({ title, query: v })
    } else {
      collectDashboardQueries(v, title, out)
    }
  }
}

/** @returns {ExtractedQuery[]} */
export const extractAlertQueries = () => {
  /** @type {ExtractedQuery[]} */
  const results = []
  for (const file of listJsonFiles(alertsDir)) {
    const json = parseJsonFile(file)
    const conditions = Array.isArray(json.conditions) ? json.conditions : []
    for (const condition of conditions) {
      const plql = condition?.conditionPrometheusQueryLanguage
      if (!plql || typeof plql.query !== 'string') {
        continue
      }
      results.push({
        source: 'alert',
        file,
        name:
          typeof plql.alertRule === 'string' && plql.alertRule.length > 0
            ? plql.alertRule
            : typeof condition.displayName === 'string'
              ? condition.displayName
              : (json.displayName ?? file),
        query: plql.query,
        durationSeconds:
          typeof plql.duration === 'string' ? plql.duration : undefined
      })
    }
  }
  return results
}

/** @returns {ExtractedQuery[]} */
export const extractDashboardQueries = () => {
  /** @type {ExtractedQuery[]} */
  const results = []
  for (const file of listJsonFiles(dashboardsDir)) {
    const json = parseJsonFile(file)
    const displayName =
      typeof json.displayName === 'string' ? json.displayName : file
    /** @type {Array<{ title: string, query: string }>} */
    const tileQueries = []
    collectDashboardQueries(json, displayName, tileQueries)
    for (const { title, query } of tileQueries) {
      results.push({
        source: 'dashboard',
        file,
        name: `${displayName} :: ${title}`,
        query
      })
    }
  }
  return results
}

/** @returns {ExtractedQuery[]} */
export const extractAllQueries = () => [
  ...extractAlertQueries(),
  ...extractDashboardQueries()
]

/**
 * Extract the distinct Prometheus metric names referenced by any PromQL expression.
 * Recognises bare metric selectors and metric names inside functions/label matchers.
 * @param {string} query
 * @returns {string[]}
 */
export const extractMetricNames = (query) => {
  // Match identifiers that look like metric names: tx_agent_kit_* or temporal_*.
  // PromQL metric names match [a-zA-Z_:][a-zA-Z0-9_:]* - we scope to our known
  // prefixes to avoid catching function names like `rate`/`sum`.
  const matches = query.match(/\b(?:tx_agent_kit|temporal)_[a-zA-Z0-9_]+/gu) ?? []
  return [...new Set(matches)]
}

// Allow `node extract-promql.mjs` to dump everything for inspection / debugging.
if (import.meta.url === `file://${process.argv[1]}`) {
  const all = extractAllQueries()
  for (const q of all) {
    process.stdout.write(
      `[${q.source}] ${q.name}\n  metrics: ${extractMetricNames(q.query).join(', ')}\n  ${q.query.replace(/\n/gu, '\n  ')}\n\n`
    )
  }
  process.stdout.write(`Total: ${all.length} queries\n`)
}
