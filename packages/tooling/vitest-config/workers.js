import { availableParallelism, cpus } from 'node:os'

const fallbackWorkerCount = 1
const maxAutoIntegrationWorkers = 6
const maxAutoWebIntegrationWorkers = 4

const parsePositiveInt = (value, fallback) => {
  if (!value) {
    return fallback
  }

  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed) || parsed < 1) {
    return fallback
  }

  return parsed
}

const resolveAutoMaxWorkers = () => {
  try {
    return Math.max(fallbackWorkerCount, availableParallelism())
  } catch {
    return Math.max(fallbackWorkerCount, cpus().length)
  }
}

const autoMaxWorkers = resolveAutoMaxWorkers()
const autoIntegrationWorkers = Math.min(autoMaxWorkers, maxAutoIntegrationWorkers)

export const resolveUnitMaxWorkers = () =>
  parsePositiveInt(process.env.TEST_MAX_WORKERS, autoMaxWorkers)

export const resolveIntegrationMaxWorkers = () =>
  parsePositiveInt(process.env.INTEGRATION_MAX_WORKERS, autoIntegrationWorkers)

export const resolveWebIntegrationMaxWorkers = () =>
  parsePositiveInt(
    process.env.WEB_INTEGRATION_MAX_WORKERS,
    Math.min(resolveIntegrationMaxWorkers(), maxAutoWebIntegrationWorkers)
  )
