import { combinedOutput, runCommand } from './command-entrypoints.js'
import { getTestkitEnv } from './env.js'

export interface LiveCommandRun {
  readonly exitCode: number
  readonly output: string
}

const testkitEnv = getTestkitEnv()

export const shouldRunLiveTunnelIntegration =
  testkitEnv.RUN_LIVE_TUNNEL_INTEGRATION === '1'

export const resolveLiveTunnelMode = (): string => testkitEnv.LIVE_TUNNEL_MODE ?? 'all'

export const runLiveTunnelCommand = (
  command: 'deploy:tunnel:reconcile' | 'deploy:tunnel:check',
  envOverrides: Readonly<NodeJS.ProcessEnv> = {}
): LiveCommandRun => {
  const result = runCommand(
    'pnpm',
    [command, resolveLiveTunnelMode()],
    envOverrides,
    5 * 60 * 1_000
  )

  return {
    exitCode: result.exitCode,
    output: combinedOutput(result)
  }
}
