import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { runIntegrationLockBash } from './integration-lock.js'

const createdTempRoots: string[] = []

const createTempRoot = (prefix: string): string => {
  const root = mkdtempSync(resolve(tmpdir(), prefix))
  createdTempRoots.push(root)
  return root
}

const formatFailure = (
  command: string,
  result: { exitCode: number; stdout: string; stderr: string }
): string =>
  [
    `Command failed: ${command}`,
    `exit=${result.exitCode}`,
    `stdout:\n${result.stdout.trim()}`,
    `stderr:\n${result.stderr.trim()}`
  ].join('\n\n')

afterAll(() => {
  for (const root of createdTempRoots.splice(0, createdTempRoots.length)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe.sequential('integration lock behavior', () => {
  it('does not reap fresh missing-pid lock directories before grace period', () => {
    const root = createTempRoot('tx-agent-kit-lock-grace-period-')
    const lockDir = resolve(root, 'integration.lock')
    mkdirSync(lockDir, { recursive: true })

    const result = runIntegrationLockBash(
      [
        `if lock_try_reap_stale '${lockDir}' 900 60; then`,
        "  echo 'reaped'",
        'else',
        "  echo 'retained'",
        'fi'
      ].join('\n')
    )

    expect(result.exitCode, formatFailure('lock_try_reap_stale fresh-lock', result)).toBe(0)
    expect(result.stdout).toContain('retained')
  })

  it('reaps missing-pid lock directories after a short grace period', () => {
    const root = createTempRoot('tx-agent-kit-lock-missing-pid-')
    const lockDir = resolve(root, 'integration.lock')
    mkdirSync(lockDir, { recursive: true })

    const result = runIntegrationLockBash(
      [
        'sleep 2',
        `if lock_try_reap_stale '${lockDir}' 900 1; then`,
        "  echo 'reaped'",
        'else',
        "  echo 'not-reaped'",
        'fi'
      ].join('\n')
    )

    expect(
      result.exitCode,
      formatFailure('lock_try_reap_stale missing-pid', result)
    ).toBe(0)
    expect(result.stdout).toContain('reaped')
  })

  it('reaps lock directories with dead pids immediately', () => {
    const root = createTempRoot('tx-agent-kit-lock-dead-pid-')
    const lockDir = resolve(root, 'integration.lock')
    mkdirSync(lockDir, { recursive: true })
    writeFileSync(resolve(lockDir, 'pid'), '999999\n', 'utf8')

    const result = runIntegrationLockBash(
      [
        `if lock_try_reap_stale '${lockDir}' 900 60; then`,
        "  echo 'reaped'",
        'else',
        "  echo 'not-reaped'",
        'fi'
      ].join('\n')
    )

    expect(result.exitCode, formatFailure('lock_try_reap_stale dead-pid', result)).toBe(0)
    expect(result.stdout).toContain('reaped')
  })

  it('allows lock_acquire to recover from missing-pid locks without waiting full timeout', () => {
    const root = createTempRoot('tx-agent-kit-lock-acquire-recover-')
    const lockDir = resolve(root, 'integration.lock')
    mkdirSync(lockDir, { recursive: true })

    const result = runIntegrationLockBash(
      [
        'sleep 2',
        'started_at=$(date +%s)',
        `lock_acquire '${lockDir}' 30 1`,
        'ended_at=$(date +%s)',
        'elapsed=$((ended_at - started_at))',
        'printf "elapsed=%s\\n" "$elapsed"',
        `lock_release '${lockDir}'`
      ].join('\n')
    )

    expect(result.exitCode, formatFailure('lock_acquire recover missing-pid', result)).toBe(0)
    const elapsedLine = result.stdout
      .split('\n')
      .find((line) => line.startsWith('elapsed='))
    expect(elapsedLine).toBeDefined()
    const elapsedSeconds = Number.parseInt(elapsedLine?.split('=')[1] ?? '', 10)
    expect(Number.isNaN(elapsedSeconds)).toBe(false)
    expect(elapsedSeconds).toBeLessThan(10)
  })

  it('times out lock_acquire when lock is held by a live process pid', () => {
    const root = createTempRoot('tx-agent-kit-lock-timeout-live-pid-')
    const lockDir = resolve(root, 'integration.lock')
    mkdirSync(lockDir, { recursive: true })

    const blocker = spawn('bash', ['-c', 'sleep 30'], {
      stdio: 'ignore'
    })

    try {
      expect(blocker.pid).toBeDefined()
      writeFileSync(resolve(lockDir, 'pid'), `${blocker.pid}\n`, 'utf8')

      const result = runIntegrationLockBash(
        [
          `if lock_acquire '${lockDir}' 2 1; then`,
          "  echo 'acquired'",
          'else',
          "  echo 'timed-out'",
          'fi'
        ].join('\n')
      )

      expect(result.exitCode, formatFailure('lock_acquire live-pid-timeout', result)).toBe(0)
      expect(result.stdout).toContain('timed-out')
    } finally {
      if (blocker.pid) {
        try {
          process.kill(blocker.pid, 'SIGKILL')
        } catch (error) {
          void error
        }
      }
    }
  })
})
