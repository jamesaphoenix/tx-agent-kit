import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { availableParallelism, cpus } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDir, '../..')

const defaultLockTimeoutSeconds = 600
const defaultMissingPidGraceSeconds = 15
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
  timeoutSeconds: number,
  missingPidGraceSeconds: number
): boolean => {
  if (!existsSync(lockDir)) {
    return false
  }

  if (existsSync(integrationLockPidFilePath)) {
    if (process.env.INTEGRATION_FORCE_LOCK_RELEASE === '1') {
      rmSync(lockDir, { recursive: true, force: true })
      return true
    }

    const parsedPid = Number.parseInt(readFileSync(integrationLockPidFilePath, 'utf8').trim(), 10)
    if (!Number.isNaN(parsedPid) && parsedPid > 0) {
      if (!isProcessAlive(parsedPid)) {
        rmSync(lockDir, { recursive: true, force: true })
        return true
      }

      try {
        const commandLine = execFileSync('ps', ['-p', String(parsedPid), '-o', 'command='], {
          cwd: projectRoot,
          env: process.env,
          encoding: 'utf8'
        })
          .trim()
          .toLowerCase()
        const looksLikeIntegrationRunner =
          commandLine.includes('vitest') ||
          commandLine.includes('run-integration.sh') ||
          commandLine.includes('test-integration-quiet.sh')

        if (!looksLikeIntegrationRunner) {
          rmSync(lockDir, { recursive: true, force: true })
          return true
        }
      } catch {
        rmSync(lockDir, { recursive: true, force: true })
        return true
      }
    }
    return false
  }

  // Lock directories are expected to always include a pid marker.
  // If it's missing, reap aggressively after a short grace window since this
  // usually means a crashed process between mkdir and pid file write.
  let lockMtimeMs: number
  try {
    lockMtimeMs = statSync(lockDir).mtimeMs
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return false
    }
    throw error
  }

  const ageMs = Date.now() - lockMtimeMs
  const effectiveMissingPidGraceSeconds = Math.min(timeoutSeconds, missingPidGraceSeconds)
  if (ageMs >= effectiveMissingPidGraceSeconds * 1000) {
    rmSync(lockDir, { recursive: true, force: true })
    return true
  }

  return false
}

const acquireIntegrationLock = async (
  lockDir: string,
  timeoutSeconds: number,
  missingPidGraceSeconds: number
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

      tryReapStaleIntegrationLock(lockDir, timeoutSeconds, missingPidGraceSeconds)

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

const resolveSignalExitCode = (signal: NodeJS.Signals): number => {
  if (signal === 'SIGINT') {
    return 130
  }

  if (signal === 'SIGTERM') {
    return 143
  }

  return 1
}

const registerLockReleaseSignalHandlers = (
  releaseLock: () => void
): (() => void) => {
  const signals: ReadonlyArray<NodeJS.Signals> = ['SIGINT', 'SIGTERM']
  const handlers = new Map<NodeJS.Signals, () => void>()

  for (const signal of signals) {
    const handler = () => {
      releaseLock()
      process.exit(resolveSignalExitCode(signal))
    }

    handlers.set(signal, handler)
    process.once(signal, handler)
  }

  return () => {
    for (const [signal, handler] of handlers.entries()) {
      process.off(signal, handler)
    }
  }
}

const readProcessCommandLine = (pid: number): string | undefined => {
  try {
    const command = execFileSync('ps', ['-p', String(pid), '-o', 'command='], {
      cwd: projectRoot,
      env: process.env,
      encoding: 'utf8'
    }).trim()

    return command.length > 0 ? command : undefined
  } catch {
    return undefined
  }
}

type ProcessClassification = 'expected' | 'unexpected' | 'unknown'

const classifyWebIntegrationApiProcess = (pid: number): ProcessClassification => {
  const commandLine = readProcessCommandLine(pid)
  if (!commandLine) {
    return 'unknown'
  }

  const normalized = commandLine.toLowerCase()
  if (normalized.includes('apps/api/src/server.ts') && normalized.includes('node')) {
    return 'expected'
  }

  return 'unexpected'
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
    if (!Number.isNaN(parsedPid) && parsedPid > 0 && isProcessAlive(parsedPid)) {
      const processClassification = classifyWebIntegrationApiProcess(parsedPid)
      if (processClassification !== 'expected') {
        process.stderr.write(
          `Skipping stop for non-harness pid ${parsedPid} (${processClassification}) in ${pidFilePath}; leaving pid marker in place\n`
        )
        continue
      }

      const stopped = await stopProcess(parsedPid)
      if (!stopped) {
        throw new Error(`Failed to stop lingering web integration API process pid=${parsedPid} slot=${workerSlot}`)
      }
    }

    rmSync(pidFilePath, { force: true })
  }

  rmSync(resolveWebIntegrationSlotClaimDir(), { recursive: true, force: true })
}

const cleanupPersistentWebHarnessSchemas = async (): Promise<void> => {
  const { cleanupPersistentWebIntegrationHarnesses } = await import(
    '../../apps/web/integration/support/web-integration-harness'
  )
  await cleanupPersistentWebIntegrationHarnesses(resolveWebIntegrationMaxWorkers())
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

  let lockHeld = false
  const releaseLock = (): void => {
    if (!lockHeld) {
      return
    }

    releaseIntegrationLock(integrationLockDir)
    lockHeld = false
  }
  const unregisterSignalHandlers = registerLockReleaseSignalHandlers(releaseLock)

  const timeoutSeconds = parsePositiveInt(
    process.env.INTEGRATION_LOCK_TIMEOUT_SECONDS,
    defaultLockTimeoutSeconds
  )
  const missingPidGraceSeconds = parsePositiveInt(
    process.env.INTEGRATION_LOCK_MISSING_PID_GRACE_SECONDS,
    defaultMissingPidGraceSeconds
  )

  await acquireIntegrationLock(integrationLockDir, timeoutSeconds, missingPidGraceSeconds)
  lockHeld = true

  try {
    await cleanupPersistentWebHarnessProcesses()
    await cleanupPersistentWebHarnessSchemas()
    runGlobalIntegrationSetup()
  } catch (error) {
    unregisterSignalHandlers()
    releaseLock()
    throw error
  }

  return async () => {
    try {
      await cleanupPersistentWebHarnessProcesses()
      await cleanupPersistentWebHarnessSchemas()
    } finally {
      unregisterSignalHandlers()
      releaseLock()
    }
  }
}
