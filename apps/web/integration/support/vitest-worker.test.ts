import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const originalCwd = process.cwd()
const envVarNames = ['WEB_INTEGRATION_MAX_WORKERS', 'VITEST_POOL_ID', 'VITEST_WORKER_ID'] as const
let currentTempDir: string | undefined
let currentChild: ChildProcess | undefined

const resolveClaimPath = (slot: number): string =>
  resolve(process.cwd(), '.vitest/web-integration/slot-claims', `slot-${slot}.lock`)

const restoreEnv = (): void => {
  for (const envVarName of envVarNames) {
    delete process.env[envVarName]
  }
}

const teardownChild = (): void => {
  if (!currentChild) {
    return
  }

  try {
    currentChild.kill('SIGKILL')
  } catch {
    // process may already be terminated
  }
  currentChild = undefined
}

const withIsolatedCwd = (): void => {
  const tempDir = mkdtempSync(resolve(tmpdir(), 'tx-agent-kit-web-worker-slot-'))
  process.chdir(tempDir)
  currentTempDir = tempDir
}

afterEach(() => {
  teardownChild()
  restoreEnv()
  vi.resetModules()
  process.chdir(originalCwd)
  if (currentTempDir) {
    rmSync(currentTempDir, { recursive: true, force: true })
    currentTempDir = undefined
  }
})

describe('resolveVitestWorkerSlot', () => {
  it('claims the next free slot when the first slot is already claimed by another live process', async () => {
    withIsolatedCwd()
    process.env.WEB_INTEGRATION_MAX_WORKERS = '3'
    process.env.VITEST_POOL_ID = '1'
    delete process.env.VITEST_WORKER_ID

    const claimDir = resolve(process.cwd(), '.vitest/web-integration/slot-claims')
    mkdirSync(claimDir, { recursive: true })

    currentChild = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30_000)'], {
      stdio: 'ignore'
    })

    if (!currentChild.pid) {
      throw new Error('Failed to start child process for slot claim test')
    }

    writeFileSync(resolveClaimPath(1), `pid=${currentChild.pid}\nworker=other\n`, 'utf8')

    const { resolveVitestWorkerSlot } = await import('./vitest-worker')
    const slot = resolveVitestWorkerSlot()

    expect(slot).toBe(2)
    expect(existsSync(resolveClaimPath(2))).toBe(true)
  })

  it('reclaims stale slot claims', async () => {
    withIsolatedCwd()
    process.env.WEB_INTEGRATION_MAX_WORKERS = '3'
    process.env.VITEST_POOL_ID = '1'
    delete process.env.VITEST_WORKER_ID

    const claimDir = resolve(process.cwd(), '.vitest/web-integration/slot-claims')
    mkdirSync(claimDir, { recursive: true })
    writeFileSync(resolveClaimPath(1), 'pid=999999\nworker=stale\n', 'utf8')

    const { resolveVitestWorkerSlot } = await import('./vitest-worker')
    const slot = resolveVitestWorkerSlot()

    expect(slot).toBe(1)

    const claimContents = readFileSync(resolveClaimPath(1), 'utf8')
    expect(claimContents).toContain(`pid=${process.pid}`)
  })
})
