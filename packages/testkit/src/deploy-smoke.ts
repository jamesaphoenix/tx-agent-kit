import { combinedOutput, runCommand, type CommandRunResult } from './command-entrypoints.js'

export interface DeploySmokeResult {
  readonly result: CommandRunResult
  readonly output: string
}

export const runDeploySmoke = (
  apiBaseUrl: string,
  timeoutMs = 120_000
): DeploySmokeResult => {
  const result = runCommand(
    'pnpm',
    ['deploy:smoke'],
    {
      API_BASE_URL: apiBaseUrl
    },
    timeoutMs
  )

  return {
    result,
    output: combinedOutput(result)
  }
}
