// Web integration tests now use the shared API server started by
// scripts/test/vitest-global-setup.ts. No per-project global setup needed.
export default (): (() => Promise<void>) => {
  return async () => {
    // No-op: shared server teardown is handled by the root globalSetup
  }
}
