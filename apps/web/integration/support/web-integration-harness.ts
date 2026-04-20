// Simplified: web integration tests now use the shared API server started by
// scripts/test/vitest-global-setup.ts. No per-worker slot management, no
// persistent processes, no pid files. This module is kept for backward
// compatibility but most exports are no-ops.

export const resolveWebIntegrationMaxWorkers = (): number => 1

export const resolveWebIntegrationBasePort = (): number => {
  const offset = Number.parseInt(process.env.WORKTREE_PORT_OFFSET ?? '0', 10)
  return 4100 + offset
}

export const resolveWebIntegrationRunId = (): string =>
  process.env.WEB_INTEGRATION_RUN_ID ?? 'webintegration'

export const resolveWebIntegrationPort = (_workerSlot: number): number =>
  resolveWebIntegrationBasePort()

export const resolveWebIntegrationSchemaPrefix = (_workerSlot: number): string =>
  'web_integration'

export const resolveWebIntegrationTestRunId = (_workerSlot: number): string =>
  resolveWebIntegrationRunId()

export const resolveWebIntegrationPidFilePath = (_workerSlot: number): string => ''

export const cleanupPersistentWebIntegrationHarnesses = async (
  _maxWorkers?: number
): Promise<void> => {
  // No-op: shared server cleanup is handled by the root global setup teardown
}
