import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { SqlTestContext } from './sql-context.js'
import { getTestkitProcessEnv } from './env.js'

const defaultPort = 4100
const defaultHost = '127.0.0.1'
const defaultStartupTimeoutMs = 40_000
const defaultHealthPath = '/health'
const defaultAuthSecret = 'integration-auth-secret-12345'

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds)
  })

export interface CreateApiServerHarnessOptions {
  testContext: SqlTestContext
  cwd: string
  host?: string
  port?: number
  authSecret?: string
  corsOrigin?: string
  startupTimeoutMs?: number
  reuseHealthyServer?: boolean
  detached?: boolean
  persistent?: boolean
  pidFilePath?: string
}

export interface ApiServerHarness {
  readonly baseUrl: string
  readonly output: ReadonlyArray<string>
  setup: () => Promise<void>
  reset: () => Promise<void>
  start: () => Promise<void>
  stop: () => Promise<void>
  teardown: () => Promise<void>
}

export const createApiServerHarness = (
  options: CreateApiServerHarnessOptions
): ApiServerHarness => {
  const host = options.host ?? defaultHost
  const port = options.port ?? defaultPort
  const authSecret = options.authSecret ?? defaultAuthSecret
  const corsOrigin = options.corsOrigin ?? '*'
  const startupTimeoutMs = options.startupTimeoutMs ?? defaultStartupTimeoutMs
  const baseUrl = `http://${host}:${port}`
  const output: string[] = []
  const reuseHealthyServer = options.reuseHealthyServer ?? false
  const detached = options.detached ?? false
  const persistent = options.persistent ?? false
  const apiServerEntryPath = resolve(options.cwd, 'src/server.ts')

  let processRef: ChildProcess | undefined

  const appendOutput = (chunk: Buffer): void => {
    output.push(chunk.toString('utf8'))
  }

  const ensurePidDirectory = (): void => {
    if (!options.pidFilePath) {
      return
    }

    mkdirSync(dirname(options.pidFilePath), { recursive: true })
  }

  const writePidFile = (pid: number | undefined): void => {
    if (!options.pidFilePath || !pid) {
      return
    }

    ensurePidDirectory()
    writeFileSync(options.pidFilePath, `${pid}\n`, 'utf8')
  }

  const removePidFile = (): void => {
    if (!options.pidFilePath) {
      return
    }

    rmSync(options.pidFilePath, { force: true })
  }

  const isHealthy = async (): Promise<boolean> => {
    try {
      const response = await fetch(`${baseUrl}${defaultHealthPath}`)
      return response.ok
    } catch {
      return false
    }
  }

  const waitForHealthy = async (): Promise<void> => {
    const startedAt = Date.now()
    let lastErrorMessage = 'unknown error'

    while (Date.now() - startedAt < startupTimeoutMs) {
      try {
        const response = await fetch(`${baseUrl}${defaultHealthPath}`)
        if (response.ok) {
          return
        }

        lastErrorMessage = `health returned status ${response.status}`
      } catch (error) {
        lastErrorMessage = error instanceof Error ? error.message : String(error)
      }

      await delay(250)
    }

    const logs = output.join('')
    throw new Error(
      [
        `API did not become healthy within ${startupTimeoutMs}ms`,
        `Last health error: ${lastErrorMessage}`,
        logs.length > 0 ? `Process output:\n${logs}` : 'Process output was empty.'
      ].join('\n\n')
    )
  }

  const waitForExit = async (
    child: ChildProcess,
    timeoutMs: number
  ): Promise<boolean> => {
    const didExit = await Promise.race([
      once(child, 'exit').then(() => true),
      delay(timeoutMs).then(() => false)
    ])

    return didExit
  }

  const setup = async (): Promise<void> => {
    await options.testContext.setup()
  }

  const reset = async (): Promise<void> => {
    await options.testContext.reset()
  }

  const start = async (): Promise<void> => {
    if (processRef && processRef.exitCode === null) {
      return
    }

    if (reuseHealthyServer && (await isHealthy())) {
      return
    }

    if (!reuseHealthyServer && (await isHealthy())) {
      throw new Error(
        [
          `Refusing to start API harness on ${baseUrl} because a healthy server is already running.`,
          'Stop the existing process or enable `reuseHealthyServer` intentionally.'
        ].join(' ')
      )
    }

    if (!existsSync(apiServerEntryPath)) {
      throw new Error(
        [
          'API harness received an invalid `apiCwd`.',
          `Missing entry file: ${apiServerEntryPath}`,
          'Resolve `apiCwd` from `import.meta.url` instead of `process.cwd()`.'
        ].join('\n')
      )
    }

    output.length = 0

    const spawned = spawn(process.execPath, ['--import', 'tsx', apiServerEntryPath], {
      cwd: options.cwd,
      env: {
        ...getTestkitProcessEnv(),
        NODE_ENV: 'test',
        API_HOST: host,
        API_PORT: String(port),
        AUTH_SECRET: authSecret,
        DATABASE_URL: options.testContext.schemaDatabaseUrl,
        API_CORS_ORIGIN: corsOrigin
      },
      stdio: detached ? 'ignore' : ['ignore', 'pipe', 'pipe'],
      detached
    })

    processRef = spawned
    writePidFile(spawned.pid)

    if (!detached) {
      spawned.stdout?.on('data', appendOutput)
      spawned.stderr?.on('data', appendOutput)
    } else {
      spawned.unref()
    }

    await waitForHealthy()

    if (spawned.exitCode !== null) {
      const logs = output.join('')
      throw new Error(
        [
          `API process exited before becoming stable on ${baseUrl}.`,
          logs.length > 0 ? `Process output:\n${logs}` : 'Process output was empty.'
        ].join('\n\n')
      )
    }
  }

  const stop = async (): Promise<void> => {
    if (persistent) {
      return
    }

    const active = processRef
    if (!active || active.exitCode !== null) {
      processRef = undefined
      removePidFile()
      return
    }

    active.kill('SIGTERM')
    const exitedAfterTerm = await waitForExit(active, 5_000)

    if (!exitedAfterTerm && active.exitCode === null) {
      active.kill('SIGKILL')
      await waitForExit(active, 2_000)
    }

    processRef = undefined
    removePidFile()
  }

  const teardown = async (): Promise<void> => {
    await stop()
    await options.testContext.teardown()
  }

  return {
    baseUrl,
    output,
    setup,
    reset,
    start,
    stop,
    teardown
  }
}
