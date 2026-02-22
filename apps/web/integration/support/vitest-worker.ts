import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const slotClaimDirRelativePath = '.vitest/web-integration/slot-claims'
const slotClaimPidRegex = /^pid=(\d+)$/

const parsePositiveIndex = (value: string | undefined): number | null => {
  if (!value) {
    return null
  }

  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed) || parsed < 1) {
    return null
  }

  return parsed
}

const resolveMaxWorkers = (): number => {
  const parsed = Number.parseInt(process.env.WEB_INTEGRATION_MAX_WORKERS ?? '3', 10)
  if (Number.isNaN(parsed) || parsed < 1) {
    return 3
  }

  return parsed
}

const toBoundedOneBasedIndex = (rawZeroBasedIndex: number, maxWorkers: number): number =>
  (rawZeroBasedIndex % maxWorkers) + 1

const resolveSlotClaimDir = (): string => {
  const claimDir = resolve(process.cwd(), slotClaimDirRelativePath)
  mkdirSync(claimDir, { recursive: true })
  return claimDir
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

  const claimContents = readFileSync(claimPath, 'utf8')
  return parseClaimPid(claimContents)
}

const clearClaimIfStale = (slot: number): void => {
  const pid = readClaimPid(slot)
  if (pid === null || !isProcessAlive(pid)) {
    rmSync(resolveSlotClaimPath(slot), { force: true })
  }
}

let resolvedWorkerSlot: number | null = null
let releaseHookRegistered = false

const registerReleaseHook = (slot: number): void => {
  if (releaseHookRegistered) {
    return
  }

  const release = (): void => {
    rmSync(resolveSlotClaimPath(slot), { force: true })
  }

  process.once('exit', release)
  releaseHookRegistered = true
}

const tryClaimSlot = (slot: number, workerIdentity: string): boolean => {
  clearClaimIfStale(slot)

  const claimPath = resolveSlotClaimPath(slot)
  const fd = (() => {
    try {
      return openSync(claimPath, 'wx')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error
      }
      return null
    }
  })()

  if (fd === null) {
    const activePid = readClaimPid(slot)
    if (activePid !== null && activePid === process.pid) {
      return true
    }
    return false
  }

  const claimBody = `pid=${process.pid}\nworker=${workerIdentity}\n`
  writeFileSync(fd, claimBody, { encoding: 'utf8' })
  closeSync(fd)
  registerReleaseHook(slot)
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

  for (let slot = 1; slot <= maxWorkers; slot += 1) {
    if (tryClaimSlot(slot, workerIdentity)) {
      resolvedWorkerSlot = slot
      return slot
    }
  }

  // Fallback: all slots were already claimed by active processes.
  // Use one of Vitest's worker identifiers to return a bounded slot.
  const worker = parsePositiveIndex(process.env.VITEST_WORKER_ID)
  if (worker !== null) {
    resolvedWorkerSlot = toBoundedOneBasedIndex(worker - 1, maxWorkers)
    return resolvedWorkerSlot
  }

  const poolWorker = parsePositiveIndex(process.env.VITEST_POOL_ID)
  if (poolWorker !== null) {
    resolvedWorkerSlot = toBoundedOneBasedIndex(poolWorker - 1, maxWorkers)
    return resolvedWorkerSlot
  }

  if (resolvedWorkerSlot === null) {
    resolvedWorkerSlot = toBoundedOneBasedIndex(process.pid, maxWorkers)
  }
  return resolvedWorkerSlot
}

export const resolveVitestWorkerOffset = (): number => {
  return resolveVitestWorkerSlot() - 1
}
