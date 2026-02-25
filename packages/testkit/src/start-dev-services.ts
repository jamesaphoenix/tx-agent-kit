import { spawn, spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { getTestkitEnv, getTestkitProcessEnv } from './env.js'

export interface StartDevServicesRunResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
  readonly durationMs: number
}

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback
  }

  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed) || parsed < 1) {
    return fallback
  }

  return parsed
}

const repoRoot = resolve(import.meta.dirname, '../../..')
const startDevServicesScriptPath = resolve(repoRoot, 'scripts/start-dev-services.sh')

const resolveSpawnTimeoutMs = (envOverrides: Readonly<NodeJS.ProcessEnv>): number => {
  const testkitEnv = getTestkitEnv()
  const readinessTimeoutSeconds = parsePositiveInt(
    envOverrides.INFRA_READY_TIMEOUT_SECONDS ?? testkitEnv.INFRA_READY_TIMEOUT_SECONDS,
    120
  )
  const headroomSeconds = parsePositiveInt(
    testkitEnv.TESTKIT_INFRA_TIMEOUT_HEADROOM_SECONDS,
    20
  )

  return (readinessTimeoutSeconds + headroomSeconds) * 1_000
}

export const runStartDevServices = (
  envOverrides: Readonly<NodeJS.ProcessEnv> = {}
): StartDevServicesRunResult => {
  const startedAtMs = Date.now()
  const result = spawnSync('bash', [startDevServicesScriptPath], {
    cwd: repoRoot,
    env: { ...getTestkitProcessEnv(), ...envOverrides },
    encoding: 'utf8',
    timeout: resolveSpawnTimeoutMs(envOverrides)
  })
  const durationMs = Date.now() - startedAtMs

  if (result.error) {
    throw result.error
  }

  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    durationMs
  }
}

export const runStartDevServicesAsync = (
  envOverrides: Readonly<NodeJS.ProcessEnv> = {}
): Promise<StartDevServicesRunResult> =>
  new Promise((resolve, reject) => {
    const startedAtMs = Date.now()
    const timeoutMs = resolveSpawnTimeoutMs(envOverrides)
    const childProcess = spawn('bash', [startDevServicesScriptPath], {
      cwd: repoRoot,
      env: { ...getTestkitProcessEnv(), ...envOverrides },
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false

    childProcess.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString()
    })
    childProcess.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString()
    })

    const timeoutHandle = setTimeout(() => {
      timedOut = true
      childProcess.kill('SIGTERM')
    }, timeoutMs)

    childProcess.on('error', (error) => {
      clearTimeout(timeoutHandle)
      reject(error)
    })

    childProcess.on('close', (code) => {
      clearTimeout(timeoutHandle)
      const durationMs = Date.now() - startedAtMs

      if (timedOut) {
        reject(
          new Error(
            `start-dev-services.sh exceeded timeout (${timeoutMs}ms)\nstdout:\n${stdout}\nstderr:\n${stderr}`
          )
        )
        return
      }

      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
        durationMs
      })
    })
  })
