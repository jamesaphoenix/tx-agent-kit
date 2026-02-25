import { createSqlTestContext } from '@tx-agent-kit/testkit'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { availableParallelism, cpus } from 'node:os'
import { dirname, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const defaultWebIntegrationBasePort = 4101
const webIntegrationStateDirRelativePath = '.vitest/web-integration'
const webIntegrationSlotClaimDirRelativePath = '.vitest/web-integration/slot-claims'
const webIntegrationPortStride = 10
const maxAutoIntegrationWorkers = 6
const maxAutoWebIntegrationWorkers = 4
const webIntegrationSupportDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(webIntegrationSupportDir, '../../../..')

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

const defaultIntegrationMaxWorkers = parsePositiveInt(
  process.env.INTEGRATION_MAX_WORKERS,
  Math.min(resolveAutoMaxWorkers(), maxAutoIntegrationWorkers)
)

const defaultWebIntegrationMaxWorkers = parsePositiveInt(
  process.env.WEB_INTEGRATION_MAX_WORKERS,
  Math.min(defaultIntegrationMaxWorkers, maxAutoWebIntegrationWorkers)
)

export const resolveWebIntegrationMaxWorkers = (): number =>
  parsePositiveInt(process.env.WEB_INTEGRATION_MAX_WORKERS, defaultWebIntegrationMaxWorkers)

export const resolveWebIntegrationBasePort = (): number =>
  parsePositiveInt(process.env.WEB_INTEGRATION_API_PORT, defaultWebIntegrationBasePort)

export const resolveWebIntegrationRunId = (): string =>
  process.env.WEB_INTEGRATION_RUN_ID ?? 'webintegration'

export const resolveWebIntegrationStateDir = (): string => {
  const stateDir = resolve(repoRoot, webIntegrationStateDirRelativePath)
  mkdirSync(stateDir, { recursive: true })
  return stateDir
}

const resolveWebIntegrationSlotClaimDir = (): string =>
  resolve(repoRoot, webIntegrationSlotClaimDirRelativePath)

const resolveKnownWorkerSlots = (maxWorkers: number): number[] => {
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

  const claimDir = resolveWebIntegrationSlotClaimDir()
  if (existsSync(claimDir)) {
    for (const fileName of readdirSync(claimDir)) {
      const match = /^slot-(\d+)\.lock$/u.exec(fileName)
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

export const resolveWebIntegrationPort = (workerSlot: number): number =>
  resolveWebIntegrationBasePort() + (workerSlot - 1) * webIntegrationPortStride

export const resolveWebIntegrationSchemaPrefix = (workerSlot: number): string =>
  `web_slot_${workerSlot}`

export const resolveWebIntegrationTestRunId = (workerSlot: number): string =>
  `${resolveWebIntegrationRunId()}_slot_${workerSlot}`

export const resolveWebIntegrationPidFilePath = (workerSlot: number): string =>
  resolve(resolveWebIntegrationStateDir(), `api-slot-${workerSlot}.pid`)

const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return code !== 'ESRCH'
  }
}

const waitForProcessExit = async (pid: number, timeoutMs: number): Promise<boolean> => {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (!isProcessAlive(pid)) {
      return true
    }

    await sleep(100)
  }

  return !isProcessAlive(pid)
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

  const exitedAfterTerm = await waitForProcessExit(pid, 5_000)
  if (exitedAfterTerm) {
    return true
  }

  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    return !isProcessAlive(pid)
  }

  return waitForProcessExit(pid, 2_000)
}

const readProcessCommandLine = (pid: number): string | undefined => {
  try {
    const command = execFileSync('ps', ['-p', String(pid), '-o', 'command='], {
      cwd: repoRoot,
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

const cleanupSchemaForSlot = async (workerSlot: number): Promise<void> => {
  const sqlContext = createSqlTestContext({
    testRunId: resolveWebIntegrationTestRunId(workerSlot),
    schemaPrefix: resolveWebIntegrationSchemaPrefix(workerSlot)
  })
  await sqlContext.teardown()
}

export const cleanupPersistentWebIntegrationHarnesses = async (
  maxWorkers = resolveWebIntegrationMaxWorkers()
): Promise<void> => {
  const knownSlots = resolveKnownWorkerSlots(maxWorkers)

  for (const workerSlot of knownSlots) {
    const pidFilePath = resolveWebIntegrationPidFilePath(workerSlot)
    let shouldCleanupSchema = true

    if (existsSync(pidFilePath)) {
      const parsedPid = Number.parseInt(readFileSync(pidFilePath, 'utf8').trim(), 10)
      if (!Number.isNaN(parsedPid) && parsedPid > 0 && isProcessAlive(parsedPid)) {
        const processClassification = classifyWebIntegrationApiProcess(parsedPid)
        if (processClassification === 'unexpected') {
          process.stderr.write(
            `Skipping stop for unexpected pid ${parsedPid} in ${pidFilePath}; preserving schema cleanup safety\n`
          )
          shouldCleanupSchema = false
          continue
        }
        if (processClassification === 'unknown') {
          process.stderr.write(
            `Could not classify pid ${parsedPid} in ${pidFilePath}; preserving pid marker and skipping schema cleanup\n`
          )
          shouldCleanupSchema = false
          continue
        }

        const stopped = await stopProcess(parsedPid)
        if (!stopped) {
          process.stderr.write(
            `Failed to stop web integration API process pid=${parsedPid} slot=${workerSlot}; skipping schema cleanup\n`
          )
          shouldCleanupSchema = false
          continue
        }

        rmSync(pidFilePath, { force: true })
      } else {
        rmSync(pidFilePath, { force: true })
      }
    }

    if (!shouldCleanupSchema) {
      continue
    }

    try {
      await cleanupSchemaForSlot(workerSlot)
    } catch (error) {
      process.stderr.write(
        `Failed to drop web integration schema for slot ${workerSlot}: ${String(error)}\n`
      )
    }
  }

  rmSync(resolveWebIntegrationSlotClaimDir(), { recursive: true, force: true })
}
