import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { availableParallelism, cpus } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDir, '../..')

const defaultLockTimeoutSeconds = 120
const maxAutoIntegrationWorkers = 6
const maxAutoWebIntegrationWorkers = 4
const composeProjectName = process.env.COMPOSE_PROJECT_NAME ?? 'tx-agent-kit'
const integrationLockDir = `/tmp/${composeProjectName}-integration.lock`
const integrationLockPidFilePath = resolve(integrationLockDir, 'pid')
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

const resolveAutoMaxWorkers = (): number => {
  try {
    return Math.max(1, availableParallelism())
  } catch {
    return Math.max(1, cpus().length)
  }
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
  lockDir: string,
  timeoutSeconds: number
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
  // If it's missing, only treat the lock as stale after a grace period.
  const ageMs = Date.now() - statSync(lockDir).mtimeMs
  if (ageMs >= timeoutSeconds * 1000) {
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

      tryReapStaleIntegrationLock(lockDir, timeoutSeconds)

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

const resolveWebIntegrationMaxWorkers = (): number => {
  const integrationMaxWorkers = parsePositiveInt(
    process.env.INTEGRATION_MAX_WORKERS,
    Math.min(resolveAutoMaxWorkers(), maxAutoIntegrationWorkers)
  )
  return parsePositiveInt(
    process.env.WEB_INTEGRATION_MAX_WORKERS,
    Math.min(integrationMaxWorkers, maxAutoWebIntegrationWorkers)
  )
}

const resolveWebIntegrationStateDir = (): string => resolve(projectRoot, '.vitest/web-integration')
const resolveWebIntegrationSlotClaimDir = (): string =>
  resolve(projectRoot, webIntegrationSlotClaimDirRelativePath)

const resolveKnownWebHarnessSlots = (maxWorkers: number): number[] => {
  const slots = new Set<number>()

  for (let workerSlot = 1; workerSlot <= maxWorkers; workerSlot += 1) {
    slots.add(workerSlot)
  }

  const stateDir = resolveWebIntegrationStateDir()
  if (existsSync(stateDir)) {
    for (const fileName of readdirSync(stateDir)) {
      const match = /^api-slot-(\d+)\.pid$/u.exec(fileName)
      const slotValue = match?.[1]
      if (!slotValue) {
        continue
      }

      const slot = Number.parseInt(slotValue, 10)
      if (!Number.isNaN(slot) && slot > 0) {
        slots.add(slot)
      }
    }
  }

  return [...slots].sort((left, right) => left - right)
}

const stopProcess = async (pid: number): Promise<boolean> => {
  if (!isProcessAlive(pid)) {
    return true
  }

  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    return !isProcessAlive(pid)
  }

  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (!isProcessAlive(pid)) {
      return true
    }
    await sleep(100)
  }

  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    return !isProcessAlive(pid)
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!isProcessAlive(pid)) {
      return true
    }
    await sleep(100)
  }

  return !isProcessAlive(pid)
}

const cleanupPersistentWebHarnessProcesses = async (): Promise<void> => {
  const stateDir = resolveWebIntegrationStateDir()
  const maxWorkers = resolveWebIntegrationMaxWorkers()
  const knownSlots = resolveKnownWebHarnessSlots(maxWorkers)

  for (const workerSlot of knownSlots) {
    const pidFilePath = resolve(stateDir, `api-slot-${workerSlot}.pid`)
    if (!existsSync(pidFilePath)) {
      continue
    }

    const parsedPid = Number.parseInt(readFileSync(pidFilePath, 'utf8').trim(), 10)
    if (!Number.isNaN(parsedPid) && parsedPid > 0) {
      const stopped = await stopProcess(parsedPid)
      if (!stopped) {
        throw new Error(`Failed to stop lingering web integration API process pid=${parsedPid} slot=${workerSlot}`)
      }
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
  process.env.AUTH_BCRYPT_ROUNDS ??= '4'

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
