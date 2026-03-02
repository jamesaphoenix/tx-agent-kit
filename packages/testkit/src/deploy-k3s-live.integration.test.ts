import { describe, expect, it } from 'vitest'
import {
  runLiveK3sStagingVerification,
  shouldRunLiveK3sStagingIntegration
} from './deploy-k3s-live.js'

describe.sequential('live k3s staging deploy integration', () => {
  it.skipIf(!shouldRunLiveK3sStagingIntegration)(
    'deploys and verifies mac k3s staging using the real deployment command',
    () => {
      const run = runLiveK3sStagingVerification()

      expect(run.exitCode).toBe(0)
      expect(run.output).toContain('Helm idempotency check passed.')
      expect(run.output).toContain('Artifact image verification passed.')
      expect(run.output).toContain('Runtime Secret/ConfigMap checks passed.')
      expect(run.output).toContain('Temporal TLS cert wiring checks passed.')
      expect(run.output).toContain('Mac k3s staging verification succeeded.')
    },
    31 * 60 * 1_000
  )
})
