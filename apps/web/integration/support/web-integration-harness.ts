import { createSqlTestContext } from '@tx-agent-kit/testkit'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const defaultWebIntegrationBasePort = 4101
const defaultWebIntegrationMaxWorkers = 3
const webIntegrationStateDirRelativePath = '.vitest/web-integration'
const webIntegrationSlotClaimDirRelativePath = '.vitest/web-integration/slot-claims'
const webIntegrationPortStride = 10

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

export const resolveWebIntegrationMaxWorkers = (): number =>
  parsePositiveInt(process.env.WEB_INTEGRATION_MAX_WORKERS, defaultWebIntegrationMaxWorkers)

export const resolveWebIntegrationBasePort = (): number =>
  parsePositiveInt(process.env.WEB_INTEGRATION_API_PORT, defaultWebIntegrationBasePort)

export const resolveWebIntegrationRunId = (): string =>
  process.env.WEB_INTEGRATION_RUN_ID ?? 'webintegration'

export const resolveWebIntegrationStateDir = (): string => {
  const stateDir = resolve(process.cwd(), webIntegrationStateDirRelativePath)
  mkdirSync(stateDir, { recursive: true })
  return stateDir
}

const resolveWebIntegrationSlotClaimDir = (): string =>
  resolve(process.cwd(), webIntegrationSlotClaimDirRelativePath)

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

const stopProcess = async (pid: number): Promise<void> => {
  if (!isProcessAlive(pid)) {
    return
  }

  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    return
  }

  const exitedAfterTerm = await waitForProcessExit(pid, 5_000)
  if (exitedAfterTerm) {
    return
  }

  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    return
  }

  await waitForProcessExit(pid, 2_000)
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
  for (let workerSlot = 1; workerSlot <= maxWorkers; workerSlot += 1) {
    const pidFilePath = resolveWebIntegrationPidFilePath(workerSlot)

    if (existsSync(pidFilePath)) {
      const parsedPid = Number.parseInt(readFileSync(pidFilePath, 'utf8').trim(), 10)
      if (!Number.isNaN(parsedPid) && parsedPid > 0) {
        await stopProcess(parsedPid)
      }
      rmSync(pidFilePath, { force: true })
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
