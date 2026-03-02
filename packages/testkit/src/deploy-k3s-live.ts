import { combinedOutput, runCommand } from './command-entrypoints.js'
import { getTestkitEnv } from './env.js'

export interface LiveCommandRun {
  readonly exitCode: number
  readonly output: string
}

const testkitEnv = getTestkitEnv()

export const shouldRunLiveK3sStagingIntegration =
  testkitEnv.RUN_LIVE_K3S_STAGING_INTEGRATION === '1'

export const runLiveK3sStagingVerification = (): LiveCommandRun => {
  const args = ['deploy:k8s:verify:staging']
  const artifactFile = testkitEnv.LIVE_K3S_STAGING_ARTIFACT_FILE
  if (!artifactFile || artifactFile.trim().length === 0) {
    return {
      exitCode: 1,
      output:
        'LIVE_K3S_STAGING_ARTIFACT_FILE is required for live k3s staging verification.'
    }
  }
  args.push(artifactFile.trim())

  const result = runCommand(
    'pnpm',
    args,
    {
      RUN_TUNNEL_CHECK_SOFT_FAIL: testkitEnv.RUN_TUNNEL_CHECK_SOFT_FAIL ?? '0',
      REQUIRE_SMOKE: '1',
      VERIFY_TEMPORAL_TLS_CERT_WIRING: '1',
      TUNNEL_RECONCILE_MODE: 'staging',
      TUNNEL_CHECK_MODE: 'staging'
    },
    30 * 60 * 1000
  )

  return {
    exitCode: result.exitCode,
    output: combinedOutput(result)
  }
}
