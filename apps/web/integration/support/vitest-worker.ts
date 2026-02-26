import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { availableParallelism, cpus } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const slotClaimDirRelativePath = '.vitest/web-integration/slot-claims'
const slotClaimPidRegex = /^pid=(\d+)$/
const staleClaimWithoutPidMs = 5_000
const defaultSlotClaimWaitMs = 60_000
const defaultSlotClaimPollMs = 100
const maxAutoIntegrationWorkers = 6
const maxAutoWebIntegrationWorkers = 4
const workerSupportDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(workerSupportDir, '../../../..')

const resolveMaxWorkers = (): number => {
  const parseEnvWorkers = (value: string | undefined): number | null => {
    if (!value) {
      return null
    }

    const parsed = Number.parseInt(value, 10)
    if (Number.isNaN(parsed) || parsed < 1) {
      return null
    }

    return parsed
  }

  const explicitWebWorkers = parseEnvWorkers(process.env.WEB_INTEGRATION_MAX_WORKERS)
  if (explicitWebWorkers !== null) {
    return explicitWebWorkers
  }

  const explicitIntegrationWorkers = parseEnvWorkers(process.env.INTEGRATION_MAX_WORKERS)
  const resolveAutoMaxWorkers = (): number => {
    try {
      return Math.max(1, availableParallelism())
    } catch {
      return Math.max(1, cpus().length)
    }
  }

  const integrationWorkers =
    explicitIntegrationWorkers ??
    Math.min(resolveAutoMaxWorkers(), maxAutoIntegrationWorkers)

  return Math.min(integrationWorkers, maxAutoWebIntegrationWorkers)
}

const resolveSlotClaimDir = (): string => {
  const claimDir = resolve(
    process.env.WEB_INTEGRATION_SLOT_CLAIM_DIR ??
      resolve(repoRoot, slotClaimDirRelativePath)
  )
  mkdirSync(claimDir, { recursive: true })
  return claimDir
}

const parsePositiveInt = (value: string | undefined): number | null => {
  if (!value) {
    return null
  }

  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed) || parsed < 0) {
    return null
  }

  return parsed
}

const resolveSlotClaimWaitMs = (): number => {
  return parsePositiveInt(process.env.WEB_INTEGRATION_SLOT_WAIT_MS) ?? defaultSlotClaimWaitMs
}

const resolveSlotClaimPollMs = (): number => {
  return parsePositiveInt(process.env.WEB_INTEGRATION_SLOT_POLL_MS) ?? defaultSlotClaimPollMs
}

const blockFor = (durationMs: number): void => {
  if (durationMs <= 0) {
    return
  }

  const slotWaitArray = new Int32Array(new SharedArrayBuffer(4))
  Atomics.wait(slotWaitArray, 0, 0, durationMs)
}

const resolveSlotClaimPath = (slot: number): string =>
  resolve(resolveSlotClaimDir(), `slot-${slot}.lock`)

const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

const parseClaimPid = (raw: string): number | null => {
  const firstLine = raw.trim().split('\n', 1)[0] ?? ''
  const match = slotClaimPidRegex.exec(firstLine)
  if (!match) {
    return null
  }

  const pidSegment = match[1]
  if (!pidSegment) {
    return null
  }

  const parsed = Number.parseInt(pidSegment, 10)
  if (Number.isNaN(parsed) || parsed < 1) {
    return null
  }
  return parsed
}

const readClaimPid = (slot: number): number | null => {
  const claimPath = resolveSlotClaimPath(slot)
  if (!existsSync(claimPath)) {
    return null
  }

  try {
    const claimContents = readFileSync(claimPath, 'utf8')
    return parseClaimPid(claimContents)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }

    throw error
  }
}

const clearClaimIfStale = (slot: number): void => {
  const claimPath = resolveSlotClaimPath(slot)
  if (!existsSync(claimPath)) {
    return
  }

  const pid = readClaimPid(slot)
  if (pid !== null) {
    if (!isProcessAlive(pid)) {
      rmSync(claimPath, { force: true })
    }
    return
  }

  try {
    const ageMs = Date.now() - statSync(claimPath).mtimeMs
    if (ageMs >= staleClaimWithoutPidMs) {
      rmSync(claimPath, { force: true })
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }
}

let resolvedWorkerSlot: number | null = null
let releaseHookRegistered = false

const releaseCurrentSlot = (): void => {
  if (resolvedWorkerSlot === null) {
    return
  }

  rmSync(resolveSlotClaimPath(resolvedWorkerSlot), { force: true })
  resolvedWorkerSlot = null
}

const registerReleaseHook = (): void => {
  if (releaseHookRegistered) {
    return
  }

  process.once('exit', releaseCurrentSlot)
  releaseHookRegistered = true
}

const tryClaimSlot = (slot: number, workerIdentity: string): boolean => {
  clearClaimIfStale(slot)

  const claimPath = resolveSlotClaimPath(slot)
  const claimBody = `pid=${process.pid}\nworker=${workerIdentity}\n`

  const tryCreateClaim = (): boolean => {
    try {
      writeFileSync(claimPath, claimBody, {
        encoding: 'utf8',
        flag: 'wx'
      })
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error
      }
      return false
    }
  }

  let claimed = tryCreateClaim()

  if (!claimed) {
    const activePid = readClaimPid(slot)
    if (activePid === null) {
      clearClaimIfStale(slot)
      claimed = tryCreateClaim()
      if (!claimed) {
        return false
      }
    } else {
      if (activePid === process.pid) {
        return true
      }
      return false
    }
  }

  registerReleaseHook()
  return true
}

export const resolveVitestWorkerSlot = (): number => {
  if (resolvedWorkerSlot !== null) {
    return resolvedWorkerSlot
  }

  const maxWorkers = resolveMaxWorkers()
  const workerIdentity = [
    process.env.VITEST_WORKER_ID,
    process.env.VITEST_POOL_ID,
    `${process.pid}`
  ]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(':')

  const slotClaimDeadline = Date.now() + resolveSlotClaimWaitMs()
  const slotClaimPollMs = resolveSlotClaimPollMs()

  while (Date.now() <= slotClaimDeadline) {
    for (let slot = 1; slot <= maxWorkers; slot += 1) {
      if (tryClaimSlot(slot, workerIdentity)) {
        resolvedWorkerSlot = slot
        return slot
      }
    }

    if (slotClaimPollMs > 0) {
      blockFor(slotClaimPollMs)
    }
  }

  const claimDir = resolveSlotClaimDir()
  throw new Error(
    [
      `Unable to claim a web integration worker slot. maxWorkers=${maxWorkers}.`,
      `workerIdentity=${workerIdentity || `pid:${process.pid}`}.`,
      `Try increasing WEB_INTEGRATION_MAX_WORKERS/INTEGRATION_MAX_WORKERS or clear stale claims at ${claimDir}.`
    ].join(' ')
  )
}

export const resolveVitestWorkerOffset = (): number => {
  return resolveVitestWorkerSlot() - 1
}

export const releaseVitestWorkerSlot = (): void => {
  releaseCurrentSlot()
}
