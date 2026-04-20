import { parsePositiveInt } from '@tx-agent-kit/contracts'
import { availableParallelism, cpus } from 'node:os'

const fallbackWorkerCount = 1
// Raised 6 → 10 (integration) and 4 → 8 (web integration). With
// `pool: 'threads', isolate: false` each worker is a cheap OS thread
// (not a process fork), so the effective cost of adding workers is just
// per-worker module-import amortisation. The old cap was sized for the
// per-file spawned API server pattern; the shared-API-server pattern
// removed that ceiling — the only remaining resource constraint is the
// Postgres pool (1000 max_connections vs 150 API + 40 worker + pg defaults).
const maxAutoIntegrationWorkers = 10
const maxAutoWebIntegrationWorkers = 8

const resolveAutoMaxWorkers = (): number => {
  try {
    return Math.max(fallbackWorkerCount, availableParallelism())
  } catch {
    return Math.max(fallbackWorkerCount, cpus().length)
  }
}

const autoMaxWorkers = resolveAutoMaxWorkers()
const autoIntegrationWorkers = Math.min(autoMaxWorkers, maxAutoIntegrationWorkers)

export const resolveUnitMaxWorkers = (): number =>
  parsePositiveInt(process.env.TEST_MAX_WORKERS, autoMaxWorkers)

export const resolveIntegrationMaxWorkers = (): number =>
  parsePositiveInt(process.env.INTEGRATION_MAX_WORKERS, autoIntegrationWorkers)

export const resolveWebIntegrationMaxWorkers = (): number =>
  parsePositiveInt(
    process.env.WEB_INTEGRATION_MAX_WORKERS,
    Math.min(resolveIntegrationMaxWorkers(), maxAutoWebIntegrationWorkers)
  )
