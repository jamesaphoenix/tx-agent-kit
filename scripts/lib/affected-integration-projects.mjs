#!/usr/bin/env node

// Compute the set of affected integration test PROJECT IDS for the local
// affected-by-default integration path (the engine behind
// `pnpm test:integration` / `pnpm test:integration:quiet` when run locally).
//
// Strategy (turbo-native, no bespoke git porcelain parsing):
//   1. Run `turbo run test:integration --filter="...[<ref>]" --dry-run=json`
//      so turbo computes the affected package graph (changed packages plus
//      their transitive dependents) using its own change detection.
//   2. Keep only task entries whose task is `test:integration` AND that have a
//      real command (turbo emits `<NONEXISTENT>` for dependent packages that
//      do not expose the script - those are pulled in for `^build` only).
//   3. Intersect those package names with the canonical integration project
//      map (`discover-integration-projects.mjs`) to translate package names
//      into the project IDs that `test-integration-quiet.sh` consumes via
//      `INTEGRATION_PROJECTS`.
//
// On ANY ambiguity (turbo failure, JSON parse failure) we exit non-zero so the
// caller can fall back to a FULL run. We never silently emit an empty set.
//
// Output: a single line of comma-separated project IDs (sorted, unique).
// Exit codes:
//   0  -> printed a non-empty CSV of affected project IDs
//   2  -> ambiguous/unable to compute (caller MUST fall back to full)

import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const repoRoot = resolve(__dirname, '../..')

const AMBIGUOUS_EXIT = 2

const baseRef = process.argv[2]
if (!baseRef) {
  process.stderr.write('affected-integration-projects: missing base ref argument\n')
  process.exit(AMBIGUOUS_EXIT)
}

const fail = (message) => {
  process.stderr.write(`affected-integration-projects: ${message}\n`)
  process.exit(AMBIGUOUS_EXIT)
}

let dryRunRaw
try {
  dryRunRaw = execFileSync(
    'pnpm',
    [
      'exec',
      'turbo',
      'run',
      'test:integration',
      `--filter=...[${baseRef}]`,
      '--dry-run=json'
    ],
    { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
  )
} catch (error) {
  fail(`turbo dry-run failed: ${error instanceof Error ? error.message : String(error)}`)
}

let dryRun
try {
  dryRun = JSON.parse(dryRunRaw)
} catch (error) {
  fail(`could not parse turbo dry-run JSON: ${error instanceof Error ? error.message : String(error)}`)
}

const tasks = Array.isArray(dryRun?.tasks) ? dryRun.tasks : null
if (!tasks) {
  fail('turbo dry-run JSON had no tasks array')
}

const affectedPackages = new Set(
  tasks
    .filter(
      (task) =>
        task?.task === 'test:integration' &&
        typeof task.command === 'string' &&
        task.command.length > 0 &&
        task.command !== '<NONEXISTENT>'
    )
    .map((task) => task.package)
    .filter((name) => typeof name === 'string' && name.length > 0)
)

// Intersect against the canonical integration project map so we only ever emit
// project IDs the workspace runner actually knows how to run.
let projectMapRaw
try {
  projectMapRaw = execFileSync(
    'node',
    [resolve(__dirname, 'discover-integration-projects.mjs')],
    { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }
  )
} catch (error) {
  fail(`could not discover integration projects: ${error instanceof Error ? error.message : String(error)}`)
}

const packageToProjectId = new Map()
for (const line of projectMapRaw.split('\n')) {
  if (!line.trim()) {
    continue
  }
  const [packageName, projectId] = line.split('\t')
  if (packageName && projectId) {
    packageToProjectId.set(packageName, projectId)
  }
}

const projectIds = new Set()
for (const packageName of affectedPackages) {
  const projectId = packageToProjectId.get(packageName)
  if (projectId) {
    projectIds.add(projectId)
  }
}

if (projectIds.size === 0) {
  // No affected integration projects after intersection. Caller decides what
  // an empty result means (typically: nothing to run). We signal it cleanly
  // via exit 0 with an empty line so the caller can distinguish "computed,
  // nothing affected" from "could not compute" (exit 2).
  process.stdout.write('\n')
  process.exit(0)
}

process.stdout.write(`${[...projectIds].sort().join(',')}\n`)
