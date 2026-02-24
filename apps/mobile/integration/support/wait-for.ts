import { setTimeout as sleep } from 'node:timers/promises'

interface WaitForOptions {
  timeoutMs?: number
  intervalMs?: number
}

export const waitFor = async (
  predicate: () => Promise<boolean> | boolean,
  options: WaitForOptions = {}
): Promise<void> => {
  const timeoutMs = options.timeoutMs ?? 8_000
  const intervalMs = options.intervalMs ?? 100
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) {
      return
    }

    await sleep(intervalMs)
  }

  throw new Error(`Timed out waiting for condition after ${timeoutMs}ms`)
}
