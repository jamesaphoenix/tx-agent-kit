#!/usr/bin/env node

/**
 * Portable wall-clock watchdog — the cross-platform fallback for the E2E
 * 120s process-kill (layer 2 of the hard budget; see
 * apps/web/e2e/playwright.config.ts globalTimeout, this watchdog, and the CI
 * timeout-minutes:2). Used only when neither GNU `timeout` (linux) nor
 * `gtimeout` (macOS coreutils) is on PATH.
 *
 * It spawns the wrapped command and, if it has not exited within the budget,
 * sends SIGTERM, then SIGKILL after a short grace period, and exits NON-ZERO so
 * a hung run can never exceed the budget on any platform.
 *
 * Usage: node wall-clock-watchdog.mjs <budgetSeconds> <command> [...args]
 */

import { spawn } from 'node:child_process'
import process from 'node:process'

const [, , budgetArg, command, ...args] = process.argv

const budgetSeconds = Number(budgetArg)
if (!Number.isFinite(budgetSeconds) || budgetSeconds <= 0 || !command) {
  process.stderr.write(
    'wall-clock-watchdog: usage: node wall-clock-watchdog.mjs <budgetSeconds> <command> [...args]\n'
  )
  process.exit(2)
}

const KILL_AFTER_MS = 10_000

const child = spawn(command, args, { stdio: 'inherit' })

let timedOut = false

const killTimer = setTimeout(() => {
  timedOut = true
  process.stderr.write(
    `\nwall-clock-watchdog: E2E run exceeded the ${budgetSeconds}s wall-clock budget — killing.\n`
  )
  child.kill('SIGTERM')
  setTimeout(() => {
    child.kill('SIGKILL')
  }, KILL_AFTER_MS).unref()
}, budgetSeconds * 1000)

child.on('exit', (code, signal) => {
  clearTimeout(killTimer)
  if (timedOut) {
    process.exit(124)
  }
  if (signal) {
    process.exit(1)
  }
  process.exit(code ?? 0)
})

child.on('error', (error) => {
  clearTimeout(killTimer)
  process.stderr.write(`wall-clock-watchdog: failed to spawn "${command}": ${String(error)}\n`)
  process.exit(127)
})
