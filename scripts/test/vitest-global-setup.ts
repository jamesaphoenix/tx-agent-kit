import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDir, '../..')

const defaultLockTimeoutSeconds = 120
const composeProjectName = process.env.COMPOSE_PROJECT_NAME ?? 'tx-agent-kit'
const integrationLockDir = `/tmp/${composeProjectName}-integration.lock`
const integrationLockPidFilePath = resolve(integrationLockDir, 'pid')
const defaultWebIntegrationMaxWorkers = 3
const webIntegrationSlotClaimDirRelativePath = '.vitest/web-integration/slot-claims'

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback
  }

  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed) || parsed < 1) {
    return fallback
  }

  return parsed
}

const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

const tryReapStaleIntegrationLock = (
  lockDir: string
): boolean => {
  if (!existsSync(lockDir)) {
    return false
  }

  if (existsSync(integrationLockPidFilePath)) {
    const parsedPid = Number.parseInt(readFileSync(integrationLockPidFilePath, 'utf8').trim(), 10)
    if (!Number.isNaN(parsedPid) && parsedPid > 0 && !isProcessAlive(parsedPid)) {
      rmSync(lockDir, { recursive: true, force: true })
      return true
    }
    return false
  }

  // Lock directories are expected to always include a pid marker.
  // If it's missing, treat the lock as stale immediately.
  const ageMs = Date.now() - statSync(lockDir).mtimeMs
  if (ageMs >= 0) {
    rmSync(lockDir, { recursive: true, force: true })
    return true
  }

  return false
}

const acquireIntegrationLock = async (
  lockDir: string,
  timeoutSeconds: number
): Promise<void> => {
  const startedAt = Date.now()

  while (true) {
    try {
      mkdirSync(lockDir)
      writeFileSync(integrationLockPidFilePath, `${process.pid}\n`, 'utf8')
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EEXIST') {
        throw error
      }

      tryReapStaleIntegrationLock(lockDir)

      const elapsedSeconds = (Date.now() - startedAt) / 1000
      if (elapsedSeconds >= timeoutSeconds) {
        throw new Error(`Timed out waiting for lock: ${lockDir}`)
      }

      await sleep(1000)
    }
  }
}

const releaseIntegrationLock = (lockDir: string): void => {
  rmSync(resolve(lockDir, 'pid'), { force: true })
  rmSync(lockDir, { recursive: true, force: true })
}

const resolveWebIntegrationMaxWorkers = (): number =>
  parsePositiveInt(process.env.WEB_INTEGRATION_MAX_WORKERS, defaultWebIntegrationMaxWorkers)

const resolveWebIntegrationStateDir = (): string => resolve(projectRoot, '.vitest/web-integration')
const resolveWebIntegrationSlotClaimDir = (): string =>
  resolve(projectRoot, webIntegrationSlotClaimDirRelativePath)

const stopProcess = async (pid: number): Promise<void> => {
  if (!isProcessAlive(pid)) {
    return
  }

  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    return
  }

  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (!isProcessAlive(pid)) {
      return
    }
    await sleep(100)
  }

  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // process may already be gone
  }
}

const cleanupPersistentWebHarnessProcesses = async (): Promise<void> => {
  const stateDir = resolveWebIntegrationStateDir()
  const maxWorkers = resolveWebIntegrationMaxWorkers()

  for (let workerSlot = 1; workerSlot <= maxWorkers; workerSlot += 1) {
    const pidFilePath = resolve(stateDir, `api-slot-${workerSlot}.pid`)
    if (!existsSync(pidFilePath)) {
      continue
    }

    const parsedPid = Number.parseInt(readFileSync(pidFilePath, 'utf8').trim(), 10)
    if (!Number.isNaN(parsedPid) && parsedPid > 0) {
      await stopProcess(parsedPid)
    }

    rmSync(pidFilePath, { force: true })
  }

  rmSync(resolveWebIntegrationSlotClaimDir(), { recursive: true, force: true })
}

const runSetupCommand = (scriptRelativePath: string, args: string[] = []): void => {
  execFileSync(resolve(projectRoot, scriptRelativePath), args, {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit'
  })
}

const runGlobalIntegrationSetup = (): void => {
  runSetupCommand('scripts/test/reset-test-db.sh')

  const shouldSkipPgTap = process.env.INTEGRATION_SKIP_PGTAP === '1'
  if (!shouldSkipPgTap) {
    runSetupCommand('scripts/test/run-pgtap.sh', ['--skip-setup'])
  }
}

export default async () => {
  const timeoutSeconds = parsePositiveInt(
    process.env.INTEGRATION_LOCK_TIMEOUT_SECONDS,
    defaultLockTimeoutSeconds
  )

  await acquireIntegrationLock(integrationLockDir, timeoutSeconds)

  try {
    await cleanupPersistentWebHarnessProcesses()
    runGlobalIntegrationSetup()
  } catch (error) {
    releaseIntegrationLock(integrationLockDir)
    throw error
  }

  return async () => {
    try {
      await cleanupPersistentWebHarnessProcesses()
    } finally {
      releaseIntegrationLock(integrationLockDir)
    }
  }
}
