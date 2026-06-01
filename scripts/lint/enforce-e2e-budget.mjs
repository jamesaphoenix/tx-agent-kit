#!/usr/bin/env node

/**
 * UN-WIDENABLE E2E BUDGET GUARD.
 *
 * The Trace Learn browser E2E wall-clock is hard-capped at 120 seconds across
 * THREE enforcement layers (see apps/web/CLAUDE.md / AGENTS.md E2E policy):
 *
 *   1. apps/web/e2e/playwright.config.ts `globalTimeout` — the whole-run cap;
 *      the run FAILS if exceeded. Per-test `timeout` and `expect.timeout` are
 *      bounded too.
 *   2. apps/web/package.json `test:e2e` — a PORTABLE 120s process-kill wrapper
 *      (GNU `timeout` / macOS `gtimeout` / node watchdog) so even a hung
 *      Playwright process dies at the budget with a non-zero exit.
 *   3. .github/workflows/integration-tests.yml — the bounded `Run Trace Learn
 *      E2E suite` STEP carries `timeout-minutes: 2` as the CI-level backstop.
 *
 * IMPORTANT — the 120s budget binds the PLAYWRIGHT TEST RUN ONLY. The suite now
 * targets a Next.js PRODUCTION build; that `next build` is a SEPARATE
 * prerequisite step and is explicitly NOT counted against the 120s. So this
 * guard enforces the budget on the TEST STEP (`timeout-minutes` on the step
 * that runs `test:e2e`), NOT on the build-inclusive `e2e:` job ceiling. The job
 * ceiling may be larger to fit the build; the TEST STEP must stay <= 2 minutes.
 *
 * This guard runs locally (pnpm lint:invariants) AND in CI. It FAILS if any of
 * those budgets is missing OR widened beyond the cap. Widening the budget is a
 * deliberate act: you must edit THIS guard (and add a written justification),
 * not just the config — which is the whole point of making it un-widenable.
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import process from 'node:process'

const repoRoot = process.cwd()
const errors = []
const toPosix = (value) => value.split(sep).join('/')
const fail = (message) => errors.push(message)
const readUtf8 = (path) => readFileSync(path, 'utf8')

// --- Budget caps (the un-widenable values) ---------------------------------
const GLOBAL_TIMEOUT_CAP_MS = 120_000
const PER_TEST_TIMEOUT_CAP_MS = 60_000
// The CI backstop binds the TEST STEP (`Run Trace Learn E2E suite`), NOT the
// build-inclusive `e2e:` job — the prod build is a separate, un-budgeted
// prerequisite. 2 minutes mirrors the 120s test-run wall-clock.
const CI_TEST_STEP_TIMEOUT_CAP_MINUTES = 2

const PLAYWRIGHT_CONFIG = 'apps/web/e2e/playwright.config.ts'
const WEB_PACKAGE_JSON = 'apps/web/package.json'
const CI_WORKFLOW = '.github/workflows/integration-tests.yml'

const requireFile = (relativePath) => {
  const absolute = resolve(repoRoot, relativePath)
  if (!existsSync(absolute)) {
    fail(`Missing required file for the E2E budget guard: \`${relativePath}\`.`)
    return null
  }
  return readUtf8(absolute)
}

// Parse `name: 123_000` / `name: 120000` numeric literals (Playwright uses `_`
// digit separators). Returns the numeric value or null if the key is absent.
const readNumericConfigValue = (source, key) => {
  const match = source.match(new RegExp(`\\b${key}\\s*:\\s*([0-9_]+)`, 'u'))
  if (!match) {
    return null
  }
  return Number(match[1].replaceAll('_', ''))
}

// --- Layer 1: playwright.config.ts ----------------------------------------
const playwrightConfig = requireFile(PLAYWRIGHT_CONFIG)
if (playwrightConfig) {
  const globalTimeout = readNumericConfigValue(playwrightConfig, 'globalTimeout')
  if (globalTimeout === null) {
    fail(
      `${PLAYWRIGHT_CONFIG}: missing \`globalTimeout\`. The whole-run wall-clock MUST be ` +
        `capped — set \`globalTimeout: ${GLOBAL_TIMEOUT_CAP_MS}\` so the run FAILS past 120s.`
    )
  } else if (globalTimeout > GLOBAL_TIMEOUT_CAP_MS) {
    fail(
      `${PLAYWRIGHT_CONFIG}: \`globalTimeout\` is ${globalTimeout}ms, above the hard ` +
        `${GLOBAL_TIMEOUT_CAP_MS}ms (120s) cap. Do not widen the E2E wall-clock budget without ` +
        `changing this guard and adding a written justification.`
    )
  }

  // Per-test timeout: the first top-level `timeout:` key in the config object.
  const perTestTimeout = readNumericConfigValue(playwrightConfig, 'timeout')
  if (perTestTimeout === null) {
    fail(`${PLAYWRIGHT_CONFIG}: missing per-test \`timeout\`. Set it at or below ${PER_TEST_TIMEOUT_CAP_MS}ms.`)
  } else if (perTestTimeout > PER_TEST_TIMEOUT_CAP_MS) {
    fail(
      `${PLAYWRIGHT_CONFIG}: per-test \`timeout\` is ${perTestTimeout}ms, above the ` +
        `${PER_TEST_TIMEOUT_CAP_MS}ms cap. A single test must not be able to consume the run budget.`
    )
  }
}

// --- Layer 2: apps/web/package.json test:e2e process-kill wrapper ----------
const webPackageJson = requireFile(WEB_PACKAGE_JSON)
if (webPackageJson) {
  let parsed
  try {
    parsed = JSON.parse(webPackageJson)
  } catch (error) {
    fail(`${WEB_PACKAGE_JSON}: could not be parsed as JSON: ${String(error)}`)
  }

  const testE2e = parsed?.scripts?.['test:e2e']
  if (!testE2e) {
    fail(`${WEB_PACKAGE_JSON}: missing the \`test:e2e\` script.`)
  } else {
    const hasTimeoutWrapper = /\b(?:g?timeout)\b/u.test(testE2e)
    const hasNodeWatchdog = /wall-clock-watchdog\.mjs/u.test(testE2e)
    const mentionsBudget = /\b120\b/u.test(testE2e)
    if (!(hasTimeoutWrapper || hasNodeWatchdog) || !mentionsBudget) {
      fail(
        `${WEB_PACKAGE_JSON}: the \`test:e2e\` script must wrap the Playwright invocation in a ` +
          `PORTABLE 120s process-kill (GNU \`timeout 120\` / macOS \`gtimeout 120\` / the node ` +
          `\`wall-clock-watchdog.mjs 120\` fallback) so even a hung run dies at the budget with a ` +
          `non-zero exit. Current script:\n    ${testE2e}`
      )
    }
  }
}

// --- Layer 3: CI e2e TEST STEP timeout-minutes ----------------------------
// The 120s budget binds the bounded `test:e2e` run, NOT the build-inclusive
// `e2e:` job. We require the workflow to have a step that (a) runs `test:e2e`
// and (b) carries its own `timeout-minutes <= 2`. The build (`e2e:build`) is a
// separate prerequisite step and is intentionally NOT budgeted here.
const ciWorkflow = requireFile(CI_WORKFLOW)
if (ciWorkflow) {
  // Find the `e2e:` job block.
  const e2eJobMatch = ciWorkflow.match(/^\s{2}e2e:\s*$/mu)
  if (!e2eJobMatch) {
    fail(
      `${CI_WORKFLOW}: missing an \`e2e:\` job. Add a Playwright/E2E job whose bounded ` +
        `\`test:e2e\` step carries \`timeout-minutes: ${CI_TEST_STEP_TIMEOUT_CAP_MINUTES}\`.`
    )
  } else {
    // Scope to the e2e job block: from `  e2e:` to the next top-level job (2-space
    // indented key) or EOF.
    const start = e2eJobMatch.index ?? 0
    const rest = ciWorkflow.slice(start + e2eJobMatch[0].length)
    const nextJob = rest.match(/^\s{2}\w[\w-]*:\s*$/mu)
    const jobBlock = nextJob ? rest.slice(0, nextJob.index) : rest

    // Locate the step that runs `test:e2e` and read the `timeout-minutes` that
    // belongs to that same step. A step is a `- ` list item: capture from a
    // `- name:` boundary through all following lines that are NOT a new `- `
    // step boundary, i.e. the whole step body that contains `test:e2e`.
    const testStepMatch = jobBlock.match(
      /-\s+name:[^\n]*(?:\n(?!\s*-\s)[^\n]*)*test:e2e[^\n]*(?:\n(?!\s*-\s)[^\n]*)*/u
    )
    if (!testStepMatch) {
      fail(
        `${CI_WORKFLOW}: the \`e2e:\` job has no step running \`test:e2e\`. The bounded ` +
          `Playwright run must be its own step carrying \`timeout-minutes: ${CI_TEST_STEP_TIMEOUT_CAP_MINUTES}\`.`
      )
    } else {
      const stepText = testStepMatch[0]
      const timeoutMatch = stepText.match(/timeout-minutes:\s*(\d+)/u)
      if (!timeoutMatch) {
        fail(
          `${CI_WORKFLOW}: the \`test:e2e\` step has no \`timeout-minutes\`. Set ` +
            `\`timeout-minutes: ${CI_TEST_STEP_TIMEOUT_CAP_MINUTES}\` on the bounded test run ` +
            `(the build step is a separate, un-budgeted prerequisite).`
        )
      } else {
        const minutes = Number(timeoutMatch[1])
        if (minutes > CI_TEST_STEP_TIMEOUT_CAP_MINUTES) {
          fail(
            `${CI_WORKFLOW}: the \`test:e2e\` step \`timeout-minutes\` is ${minutes}, above the ` +
              `${CI_TEST_STEP_TIMEOUT_CAP_MINUTES}-minute cap. Do not widen the CI E2E test-run budget ` +
              `without changing this guard and a justification.`
          )
        }
      }
    }
  }
}

if (errors.length > 0) {
  process.stderr.write(
    'E2E budget guard FAILED — the 120s wall-clock budget is hard-enforced:\n\n' +
      errors.map((message) => `  - ${message}`).join('\n\n') +
      '\n'
  )
  process.exit(1)
}

process.stdout.write(
  `E2E budget guard PASSED: globalTimeout <= ${GLOBAL_TIMEOUT_CAP_MS}ms, per-test timeout <= ` +
    `${PER_TEST_TIMEOUT_CAP_MS}ms, test:e2e has the portable 120s process-kill, CI \`test:e2e\` ` +
    `step timeout-minutes <= ${CI_TEST_STEP_TIMEOUT_CAP_MINUTES} (the prod build is a separate ` +
    `un-budgeted prerequisite).\n`
)
