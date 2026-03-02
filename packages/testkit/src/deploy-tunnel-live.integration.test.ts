import { describe, expect, it } from 'vitest'
import {
  runLiveTunnelCommand,
  shouldRunLiveTunnelIntegration
} from './deploy-tunnel-live.js'
import { getTestkitEnv } from './env.js'

const shouldRunLiveTunnelNegativeIntegration =
  getTestkitEnv().RUN_LIVE_TUNNEL_NEGATIVE_INTEGRATION === '1'

describe.sequential('live cloudflare tunnel integration', () => {
  it.skipIf(!shouldRunLiveTunnelIntegration)(
    'reconciles and checks real tunnel routing for requested mode',
    () => {
      const reconcile = runLiveTunnelCommand('deploy:tunnel:reconcile')
      expect(reconcile.exitCode).toBe(0)
      expect(reconcile.output).toContain('Cloudflare tunnel config reconciled')

      const check = runLiveTunnelCommand('deploy:tunnel:check')
      expect(check.exitCode).toBe(0)
      expect(check.output).toMatch(/Tunnel route check passed/u)
      expect(check.output).toMatch(/Tunnel health passed/u)
    },
    11 * 60 * 1000
  )

  it.skipIf(!shouldRunLiveTunnelNegativeIntegration)(
    'fails loudly when required tunnel host configuration is missing',
    () => {
      const run = runLiveTunnelCommand('deploy:tunnel:check', {
        LIVE_TUNNEL_MODE: 'dev',
        CLOUDFLARE_TUNNEL_HOST_DEV: ''
      })

      expect(run.exitCode).not.toBe(0)
      expect(run.output).toContain('Missing tunnel host for dev')
    },
    3 * 60 * 1000
  )

  it.skipIf(!shouldRunLiveTunnelNegativeIntegration)(
    'fails loudly when tunnel endpoint is unreachable over real network calls',
    () => {
      const run = runLiveTunnelCommand('deploy:tunnel:check', {
        LIVE_TUNNEL_MODE: 'dev',
        CLOUDFLARE_TUNNEL_HOST_DEV: 'unreachable.invalid',
        CLOUDFLARE_TUNNEL_CHECK_ATTEMPTS: '1',
        CLOUDFLARE_TUNNEL_CHECK_SLEEP_SECONDS: '1'
      })

      expect(run.exitCode).not.toBe(0)
      expect(run.output).toContain('Tunnel health check failed for unreachable.invalid')
    },
    3 * 60 * 1000
  )
})
