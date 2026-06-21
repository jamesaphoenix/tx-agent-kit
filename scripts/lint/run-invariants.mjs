#!/usr/bin/env node
/**
 * Parallel runner for the structural lint invariants.
 *
 * The invariant checks are independent, read-only structural validations. Run
 * serially via `&&` they used to dominate the CI Lint step purely on Node
 * process-startup cost. This runner spawns the independent checks concurrently
 * (bounded by a concurrency cap), buffers each task's output, then replays the
 * buffered output in a deterministic definition order and exits non-zero if any
 * task failed.
 *
 * Determinism guarantees preserved from the old `&&` chain:
 *   - Aggregated output is printed in the same fixed order every run
 *     (definition order below), regardless of which task finishes first.
 *   - Any single failing check fails the whole run (non-zero exit).
 *   - Ordered pairs that must stay sequential (a `--self-check` detector test
 *     followed by its real run) are grouped into one task and run in order.
 */
import { spawn } from 'node:child_process'
import { availableParallelism } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..')
const tsxBin = resolve(repoRoot, 'node_modules', '.bin', 'tsx')

const node = process.execPath
const lint = (script) => resolve(here, script)

/**
 * Each entry is one parallel task. A task is an ordered list of commands run
 * sequentially inside that task (used to keep `--self-check` + real-run pairs
 * together). Tasks themselves run concurrently. `label` is used for the
 * deterministic aggregated header.
 */
const tasks = [
  { label: 'domain-invariants', commands: [[node, lint('enforce-domain-invariants.mjs')]] },
  { label: 'web-client-contracts', commands: [[node, lint('enforce-web-client-contracts.mjs')]] },
  { label: 'route-kind-contracts', commands: [[node, lint('enforce-route-kind-contracts.mjs')]] },
  { label: 'source-type-safety', commands: [[node, lint('enforce-source-type-safety.mjs')]] },
  { label: 'compose-runtime-contracts', commands: [[node, lint('enforce-compose-runtime-contracts.mjs')]] },
  { label: 'tsconfig-alignment', commands: [[node, lint('enforce-tsconfig-alignment.mjs')]] },
  { label: 'domain-event-contracts', commands: [[node, lint('enforce-domain-event-contracts.mjs')]] },
  { label: 'enum-sync', commands: [[node, lint('enforce-enum-sync.mjs')]] },
  { label: 'no-hardcoded-test-emails', commands: [[node, lint('enforce-no-hardcoded-test-emails.mjs')]] },
  { label: 'product-leaks', commands: [[node, lint('enforce-product-leak-and-secret-policy.mjs')]] },
  {
    label: 'agent-surfaces:check',
    commands: [[tsxBin, resolve(repoRoot, 'scripts', 'generate-agent-client-surfaces.ts'), '--check']]
  },
  { label: 'agent-client-surface-sync', commands: [[node, lint('enforce-agent-client-surface-sync.mjs')]] },
  {
    label: 'permissions:check',
    commands: [[node, '--import', 'tsx', resolve(repoRoot, 'scripts', 'permissions-sync.mjs'), '--check']]
  },
  { label: 'e2e-budget', commands: [[node, lint('enforce-e2e-budget.mjs')]] }
]

const runCommand = ([command, ...args]) =>
  new Promise((resolvePromise) => {
    const child = spawn(command, args, { cwd: repoRoot, env: process.env })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', (error) => {
      resolvePromise({ code: 1, stdout, stderr: `${stderr}${error.message}\n` })
    })
    child.on('close', (code) => {
      resolvePromise({ code: code ?? 1, stdout, stderr })
    })
  })

const runTask = async (task) => {
  let stdout = ''
  let stderr = ''
  for (const command of task.commands) {
    const result = await runCommand(command)
    stdout += result.stdout
    stderr += result.stderr
    if (result.code !== 0) {
      return { label: task.label, ok: false, stdout, stderr }
    }
  }
  return { label: task.label, ok: true, stdout, stderr }
}

const concurrency = Math.max(1, Math.min(tasks.length, availableParallelism()))

const results = new Array(tasks.length)
let nextIndex = 0

const worker = async () => {
  for (;;) {
    const index = nextIndex
    nextIndex += 1
    if (index >= tasks.length) {
      return
    }
    results[index] = await runTask(tasks[index])
  }
}

const workers = Array.from({ length: concurrency }, () => worker())
await Promise.all(workers)

let failed = false
for (const result of results) {
  if (result.stdout) {
    process.stdout.write(result.stdout)
  }
  if (result.stderr) {
    process.stderr.write(result.stderr)
  }
  if (!result.ok) {
    failed = true
  }
}

if (failed) {
  const failedLabels = results.filter((result) => !result.ok).map((result) => result.label)
  process.stderr.write(`\nStructural invariant checks failed: ${failedLabels.join(', ')}\n`)
  process.exit(1)
}

process.stdout.write(`\nAll ${tasks.length} structural invariant checks passed.\n`)
