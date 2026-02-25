import { cleanupPersistentWebIntegrationHarnesses } from './integration/support/web-integration-harness'

export default (): (() => Promise<void>) => {
  return async () => {
    await cleanupPersistentWebIntegrationHarnesses()
  }
}
