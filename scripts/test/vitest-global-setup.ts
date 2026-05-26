import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { closeSync, existsSync, openSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync, type Dirent } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createConnection, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'

import { config as loadDotenv } from 'dotenv'
import {
  applyStripeIntegrationTestEnv,
  stripeIntegrationTestEnvOverrides,
  type StripeIntegrationTestMode
} from './stripe-test-env.js'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDir, '../..')

// Per-worktree suffix: a short hash of the absolute project root. Keeps
// lockfile / marker names unique across sibling worktrees without leaking
// filesystem paths into /tmp directory listings.
const projectRootHash = createHash('sha1').update(projectRoot).digest('hex').slice(0, 8)

// ---------------------------------------------------------------------------
// Source-tree mtime staleness (experiment_014)
// ---------------------------------------------------------------------------
// The persistent API + worker reuse path from experiment_011 is fast but
// dangerous on its own — `tsx` bakes the module graph at spawn time, so any
// edit to apps/** or packages/** would land a subtle footgun: tests run
// against STALE compiled code without any visible signal. Invalidate the
// lockfile (force a respawn) whenever any source file is newer than the
// lock's `startedAt`.
//
// The walk is whole-tree and extension-agnostic — `.ts` / `.tsx` / `.sql` /
// `.json` / `.yaml` / whatever. Listing specific extensions invites drift
// every time a new tool, schema, or config format enters the repo. Excluded
// directories are the obvious noise ones: node_modules, dist, .next, .turbo,
// .vercel, coverage, out, .expo, .git.
//
// Two walks, two caches — one for the whole source tree (gates API+worker
// lock reuse) and a narrower one for db migration/schema files (gates the
// DB reset marker). Narrower db walk so a `.tsx` edit doesn't cost the ~6-10s
// reset-test-db.sh run every time.
const ignoredDirNamesForMtimeWalk = new Set<string>([
  'node_modules',
  'dist',
  '.next',
  '.turbo',
  '.vercel',
  'coverage',
  'out',
  '.expo',
  '.git'
])

const walkForNewestMtimeMs = (roots: readonly string[]): number => {
  let newest = 0
  const stack: string[] = roots.filter(existsSync).slice()
  while (stack.length > 0) {
    const dir = stack.pop() as string
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true }) as unknown as Dirent[]
    } catch {
      continue
    }
    for (const entry of entries) {
      const name = entry.name
      if (entry.isDirectory()) {
        if (ignoredDirNamesForMtimeWalk.has(name)) { continue }
        stack.push(resolve(dir, name))
        continue
      }
      if (!entry.isFile()) { continue }
      try {
        const fileStat = statSync(resolve(dir, name))
        if (fileStat.mtimeMs > newest) {
          newest = fileStat.mtimeMs
        }
      } catch {
        // ignore transient stat errors
      }
    }
  }
  return newest
}

let cachedNewestSourceMtimeMs: number | undefined
const getNewestSourceMtimeMs = (): number => {
  if (cachedNewestSourceMtimeMs !== undefined) { return cachedNewestSourceMtimeMs }
  cachedNewestSourceMtimeMs = walkForNewestMtimeMs([
    resolve(projectRoot, 'apps'),
    resolve(projectRoot, 'packages')
  ])
  return cachedNewestSourceMtimeMs
}

let cachedNewestDbMtimeMs: number | undefined
const getNewestDbMtimeMs = (): number => {
  if (cachedNewestDbMtimeMs !== undefined) { return cachedNewestDbMtimeMs }
  // Drizzle stores migration files under drizzle/migrations, not a top-level
  // migrations/ dir. schemas/ holds the desired-state SQL the reset script
  // reapplies via `pnpm db:schemas:apply`, pgtap/ is the trigger contract
  // suite that runs inside the reset pipeline.
  cachedNewestDbMtimeMs = walkForNewestMtimeMs([
    resolve(projectRoot, 'packages/infra/db/drizzle/migrations'),
    resolve(projectRoot, 'packages/infra/db/schemas'),
    resolve(projectRoot, 'packages/infra/db/pgtap')
  ])
  return cachedNewestDbMtimeMs
}

// ---------------------------------------------------------------------------
// 1. Load dotenv
// ---------------------------------------------------------------------------
const dotenvPath = resolve(projectRoot, '.env')
if (!existsSync(dotenvPath)) {
  const isWorktree = projectRoot.includes('.worktrees') || existsSync(resolve(projectRoot, '..', '..', '.git'))
  if (isWorktree) {
    throw new Error(
      `Missing .env in worktree: ${projectRoot}\nRun: ./scripts/worktree/setup.sh ${projectRoot}`
    )
  }
  throw new Error(
    `Missing .env in: ${projectRoot}\nRun: cp .env.example .env`
  )
}
loadDotenv({ path: dotenvPath })
const stripeIntegrationTestMode = applyStripeIntegrationTestEnv(process.env)

const resolveComposeHostPort = (
  serviceName: string,
  containerPort: string
): string | undefined => {
  try {
    const output = execFileSync(
      'docker',
      ['compose', '-p', process.env.COMPOSE_PROJECT_NAME ?? 'tx-agent-kit', 'port', serviceName, containerPort],
      {
        cwd: projectRoot,
        env: process.env,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      }
    ).trim()

    const port = output.match(/:(\d+)$/u)?.[1]
    return port && port.length > 0 ? port : undefined
  } catch {
    return undefined
  }
}

const hydrateRedisIntegrationEnv = (): void => {
  if (process.env.REDIS_URL) {
    return
  }

  process.env.REDIS_PORT ??= resolveComposeHostPort('redis', '6379') ?? '6379'
  process.env.REDIS_URL = `redis://127.0.0.1:${process.env.REDIS_PORT}`
}

// Worktree invariant: ensure required keys exist
const isWorktreeRoot = projectRoot.includes('.worktrees') || existsSync(resolve(projectRoot, '..', '..', '.git'))
if (isWorktreeRoot) {
  const requiredKeys = ['DATABASE_SCHEMA', 'API_PORT', 'WEB_PORT', 'WORKTREE_PORT_OFFSET'] as const
  const missing = requiredKeys.filter(k => !process.env[k])
  if (missing.length > 0) {
    throw new Error(
      `Worktree .env is missing required keys: ${missing.join(', ')}\nRun: bash scripts/worktree/setup.sh ${projectRoot}`
    )
  }
}

// ---------------------------------------------------------------------------
// 2. Docker health check (Postgres + Redis)
// ---------------------------------------------------------------------------
const probeTcp = (host: string, port: number, timeoutMs = 3000): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    const socket: Socket = createConnection({ host, port })
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error(`TCP connect to ${host}:${port} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    socket.once('connect', () => {
      clearTimeout(timer)
      socket.destroy()
      resolve()
    })
    socket.once('error', (error) => {
      clearTimeout(timer)
      socket.destroy()
      reject(error)
    })
  })

const assertDockerInfraHealthy = async (): Promise<void> => {
  // Parse host/port from DATABASE_URL, fallback to localhost:5432
  let pgHost = 'localhost'
  let pgPort = 5432
  const dbUrl = process.env.DATABASE_URL
  if (dbUrl) {
    try {
      const parsed = new URL(dbUrl)
      pgHost = parsed.hostname || pgHost
      pgPort = parsed.port ? Number.parseInt(parsed.port, 10) : pgPort
    } catch {
      // URL parsing failed, use defaults
    }
  }

  try {
    await probeTcp(pgHost, pgPort)
  } catch (error) {
    throw new Error(
      'Integration tests require Docker infrastructure.\n' +
      'Run: pnpm infra:ensure\n\n' +
      'Postgres must be running before tests can start.\n' +
      `Connection error: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

// ---------------------------------------------------------------------------
// 3. Migrations + pgTAP
// ---------------------------------------------------------------------------
const runSetupCommand = (scriptRelativePath: string, args: string[] = []): void => {
  execFileSync(resolve(projectRoot, scriptRelativePath), args, {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit'
  })
}

// Skip `reset-test-db.sh` (migrations + data reset + schemas:apply) when the
// DB was successfully reset for THIS worktree within the last hour. The reset
// is idempotent but costly (~10-15s): `pnpm db:migrate` walks every migration
// file, the reset SQL takes a lock on every table, and `db:schemas:apply`
// re-runs every trigger file. None of that is needed between consecutive
// integration runs in the same dev loop. The marker lives under os.tmpdir()
// with a hash-qualified name so sibling worktrees don't collide and so a
// recycled WORKTREE_PORT_OFFSET can't reuse a stale marker.
const dbResetMarkerPath = resolve(tmpdir(), `tx-agent-db-reset-${projectRootHash}.marker`)
const dbResetMarkerTtlMs = 60 * 60 * 1000

const dbResetIsRecent = (): boolean => {
  if (process.env.TX_FORCE_FRESH_INTEGRATION_SETUP === '1') {
    return false
  }
  try {
    const markerStat = statSync(dbResetMarkerPath)
    const ageMs = Date.now() - markerStat.mtimeMs
    if (ageMs < 0 || ageMs >= dbResetMarkerTtlMs) { return false }
    // Any migration / schema / pgtap file newer than the marker means the
    // reset we cached is stale — re-run to pick up the new SQL state.
    if (getNewestDbMtimeMs() > markerStat.mtimeMs) {
      process.stderr.write(
        `[globalSetup] DB reset marker is younger than 1h but a migration/schema file is newer — re-running reset-test-db.sh.\n`
      )
      return false
    }
    return true
  } catch {
    return false
  }
}

const touchDbResetMarker = (): void => {
  try {
    if (existsSync(dbResetMarkerPath)) {
      const now = new Date()
      utimesSync(dbResetMarkerPath, now, now)
      return
    }
    writeFileSync(dbResetMarkerPath, `${new Date().toISOString()}\n${projectRoot}\n`, 'utf8')
  } catch {
    // Markers are an optimisation only — never fail a test run because we
    // couldn't write one.
  }
}

const runGlobalIntegrationSetup = (): void => {
  if (dbResetIsRecent()) {
    process.stderr.write(
      `[globalSetup] Skipping reset-test-db.sh — recent reset marker found at ${dbResetMarkerPath}. ` +
      `Set TX_FORCE_FRESH_INTEGRATION_SETUP=1 to override.\n`
    )
  } else {
    runSetupCommand('scripts/test/reset-test-db.sh')
    touchDbResetMarker()
  }
  // pgTAP has its own dedicated runner (`pnpm test:db:pgtap`) and CI runs it
  // as a separate step. Re-running it inside every vitest integration suite
  // duplicates the work and adds ~6–8s per run. Opt-in via
  // INTEGRATION_RUN_PGTAP=1 when diagnosing trigger contracts alongside
  // integration tests; default is off.
  if (process.env.INTEGRATION_RUN_PGTAP === '1') {
    runSetupCommand('scripts/test/run-pgtap.sh', ['--skip-setup'])
  }
}

// ---------------------------------------------------------------------------
// 4. Shared integration API server
// ---------------------------------------------------------------------------
const worktreePortOffset = Number.parseInt(process.env.WORKTREE_PORT_OFFSET ?? '0', 10)
const integrationApiPort = 4100 + worktreePortOffset
const integrationApiBaseUrl = `http://127.0.0.1:${integrationApiPort}`
const sharedApiAuthSecret = 'integration-shared-auth-secret-32ch'
const fakeOpenRouterPort = 4300 + worktreePortOffset
const fakeOpenRouterBaseUrl = `http://127.0.0.1:${fakeOpenRouterPort}`

const readRequestBody = async (request: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = []
  for await (const chunk of request as AsyncIterable<string | Buffer>) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

const sendJson = (response: ServerResponse, statusCode: number, payload: unknown): void => {
  response.statusCode = statusCode
  response.setHeader('content-type', 'application/json')
  response.end(JSON.stringify(payload))
}

const killPortOccupant = (port: number): void => {
  try {
    execFileSync('bash', ['-c', `lsof -ti :${port} | xargs kill -9 2>/dev/null`], {
      cwd: projectRoot,
      stdio: 'ignore'
    })
  } catch {
    // Nothing to kill.
  }
}

const buildTestEmbedding = (dimensions: number): number[] =>
  Array.from({ length: dimensions }, (_, index) => (index === 0 ? 1 : 0))

const startFakeOpenRouterServer = async (): Promise<Server> => {
  killPortOccupant(fakeOpenRouterPort)
  const requests: Array<Record<string, unknown>> = []

  const server = createServer((request, response) => {
    void (async () => {
      try {
        const url = new URL(request.url ?? '/', fakeOpenRouterBaseUrl)

        if (request.method === 'POST' && url.pathname === '/embeddings') {
          const body = JSON.parse(await readRequestBody(request)) as Record<string, unknown>
          const dimensions =
            typeof body.dimensions === 'number' && body.dimensions > 0
              ? body.dimensions
              : 1536
          requests.push({ __testPath: url.pathname, ...body })
          sendJson(response, 200, {
            object: 'list',
            data: [
              {
                object: 'embedding',
                embedding: buildTestEmbedding(dimensions),
                index: 0
              }
            ],
            model:
              typeof body.model === 'string'
                ? body.model
                : 'openai/text-embedding-3-small',
            usage: {
              prompt_tokens: 8,
              total_tokens: 8,
              cost: 0.000_12
            }
          })
          return
        }

        if (request.method === 'POST' && url.pathname === '/responses') {
          const body = JSON.parse(await readRequestBody(request)) as Record<string, unknown>
          requests.push({ __testPath: url.pathname, ...body })
          sendJson(response, 200, {
            id: 'resp_fake_ai_integration',
            object: 'response',
            created_at: Math.floor(Date.now() / 1000),
            completed_at: Math.floor(Date.now() / 1000),
            model: typeof body.model === 'string' ? body.model : 'openai/gpt-4.1-mini',
            status: 'completed',
            output: [
              {
                id: 'msg_fake_ai_integration',
                type: 'message',
                status: 'completed',
                role: 'assistant',
                content: [{ type: 'output_text', text: 'ok', annotations: [] }]
              }
            ],
            output_text: 'ok',
            error: null,
            incomplete_details: null,
            usage: {
              input_tokens: 12,
              input_tokens_details: { cached_tokens: 0 },
              output_tokens: 3,
              output_tokens_details: { reasoning_tokens: 0 },
              total_tokens: 15,
              cost: 0.000_21
            },
            temperature: null,
            top_p: null,
            presence_penalty: null,
            frequency_penalty: null,
            metadata: null,
            tools: [],
            tool_choice: 'auto',
            parallel_tool_calls: true
          })
          return
        }

        if (request.method === 'GET' && url.pathname === '/__test/checkpoint') {
          sendJson(response, 200, { cursor: requests.length })
          return
        }

        if (request.method === 'GET' && url.pathname === '/__test/requests') {
          const after = Number.parseInt(url.searchParams.get('after') ?? '0', 10)
          const cursor = Number.isNaN(after) || after < 0 ? 0 : after
          sendJson(response, 200, {
            requests: requests.slice(cursor),
            nextCursor: requests.length
          })
          return
        }

        sendJson(response, 404, { error: 'not_found' })
      } catch (error: unknown) {
        sendJson(response, 500, {
          error: error instanceof Error ? error.message : String(error)
        })
      }
    })()
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(fakeOpenRouterPort, '127.0.0.1', () => resolve())
  })

  process.env.OPENROUTER_API_KEY = 'integration-openrouter-test-key'
  process.env.OPENROUTER_BASE_URL = fakeOpenRouterBaseUrl
  process.env.INTEGRATION_FAKE_OPENROUTER_BASE_URL = fakeOpenRouterBaseUrl

  return server
}

const closeServer = async (server: Server): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })

// Lockfiles for persistent server reuse across consecutive runs.
// The files embed (WORKTREE_PORT_OFFSET, projectRootHash) so two filesystem
// checkouts (or a recycled offset) can never accidentally share a lockfile.
const lockSuffix = `${worktreePortOffset}-${projectRootHash}`
const apiLockfilePath = resolve(tmpdir(), `tx-agent-shared-api-${lockSuffix}.lock`)
const workerLockfilePath = resolve(tmpdir(), `tx-agent-shared-worker-${lockSuffix}.lock`)
const apiLogfilePath = resolve(tmpdir(), `tx-agent-shared-api-${lockSuffix}.log`)
const workerLogfilePath = resolve(tmpdir(), `tx-agent-shared-worker-${lockSuffix}.log`)

const openLogFd = (path: string): number => {
  // Truncate on every fresh spawn so stale buffer data never confuses
  // error diagnostics; reused processes skip this path entirely.
  return openSync(path, 'w')
}

interface LockFileContents {
  pid: number
  startedAt: number
  port?: number
  stripeMode?: StripeIntegrationTestMode
}

const readLockFile = (path: string): LockFileContents | null => {
  try {
    const raw = readFileSync(path, 'utf8')
    const parsed = JSON.parse(raw) as Partial<LockFileContents>
    if (typeof parsed.pid !== 'number' || typeof parsed.startedAt !== 'number') {
      return null
    }
    return {
      pid: parsed.pid,
      startedAt: parsed.startedAt,
      port: parsed.port,
      stripeMode: parsed.stripeMode
    }
  } catch {
    return null
  }
}

const writeLockFile = (path: string, contents: LockFileContents): void => {
  try {
    writeFileSync(path, JSON.stringify(contents), 'utf8')
  } catch {
    // Lockfile is an optimisation only; never fail the test run because we
    // couldn't persist one.
  }
}

const pidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const terminateLockedProcess = (lock: LockFileContents, reason: string): void => {
  try {
    process.kill(lock.pid, 'SIGTERM')
    process.stderr.write(`[globalSetup] Stopped stale shared process pid=${lock.pid}: ${reason}\n`)
  } catch {
    // The lock was stale or the process exited between pidAlive() and kill().
  }
}

// Teardown is a pure no-op — the persistent pattern leaves every spawned
// child alive for the next invocation's lockfile reuse path. That means
// no markReused / isReused helpers are needed: fresh spawns AND the
// reused stub handles both go straight through stopSharedApiServer /
// stopSharedWorker unchanged.

const tryReuseSharedApiServer = async (): Promise<ChildProcess | null> => {
  if (process.env.TX_FORCE_FRESH_INTEGRATION_SETUP === '1') {
    return null
  }
  const lock = readLockFile(apiLockfilePath)
  if (lock?.port !== integrationApiPort || !pidAlive(lock.pid)) {
    return null
  }
  if (lock.stripeMode !== stripeIntegrationTestMode) {
    process.stderr.write(
      `[globalSetup] Shared API Stripe mode changed (${lock.stripeMode ?? 'unknown'} -> ${stripeIntegrationTestMode}) — respawning.\n`
    )
    return null
  }
  // Source staleness gate: if any file under apps/** or packages/** is
  // newer than lock.startedAt, the persistent API is running compiled code
  // that predates the edit. Respawn so tests don't silently hit stale
  // behaviour. Extension-agnostic so .sql / .json / .yaml / new-tool-of-
  // the-month all count. See experiment_014.
  const newestSourceMtimeMs = getNewestSourceMtimeMs()
  if (newestSourceMtimeMs > lock.startedAt) {
    process.stderr.write(
      `[globalSetup] Source files newer than shared API lock (newest=${new Date(newestSourceMtimeMs).toISOString()}, started=${new Date(lock.startedAt).toISOString()}) — respawning.\n`
    )
    return null
  }
  // Verify the process is actually healthy at the expected URL.
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 1000)
    const res = await fetch(`${integrationApiBaseUrl}/health`, { signal: controller.signal })
    clearTimeout(timer)
    if (!res.ok) { return null }
  } catch {
    return null
  }

  process.stderr.write(`[globalSetup] Reusing shared API server pid=${lock.pid} on ${integrationApiBaseUrl}\n`)
  process.env.INTEGRATION_API_PORT = String(integrationApiPort)
  process.env.INTEGRATION_API_BASE_URL = integrationApiBaseUrl
  process.env.INTEGRATION_AUTH_SECRET = sharedApiAuthSecret
  process.env.TX_INTEGRATION_SHARED_API_READY = '1'

  // Return a dummy ChildProcess-like stub so the caller's type signature
  // stays the same. `pid` reflects the reused PID; `exitCode` stays null;
  // teardown skips it because the reused flag is set.
  const stub = { pid: lock.pid, exitCode: null, kill: () => false } as unknown as ChildProcess
  return stub
}

const startSharedApiServer = async (): Promise<ChildProcess> => {
  const reused = await tryReuseSharedApiServer()
  if (reused) { return reused }

  const apiCwd = resolve(projectRoot, 'apps/api')
  const apiServerEntryPath = resolve(apiCwd, 'src/server.ts')

  if (!existsSync(apiServerEntryPath)) {
    throw new Error(`Cannot start shared integration API server. Missing: ${apiServerEntryPath}`)
  }

  // Kill any zombie on the port (only when spawning fresh — reuse path
  // already validated the existing process).
  try {
    execFileSync('bash', ['-c', `lsof -ti :${integrationApiPort} | xargs kill -9 2>/dev/null`], {
      cwd: projectRoot,
      stdio: 'ignore'
    })
  } catch { /* no process to kill */ }

  // Open log fds so the detached child has its own stdout/stderr independent
  // of vitest's pipe lifetime. If stdio were 'pipe' + event listeners, the
  // pipes would close on vitest exit and the child would crash on EPIPE
  // (defeating the whole point of detached reuse).
  const apiLogFd = openLogFd(apiLogfilePath)
  const apiProcess = spawn(
    process.execPath,
    ['--import', 'tsx', apiServerEntryPath],
    {
      cwd: apiCwd,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        API_HOST: '127.0.0.1',
        API_PORT: String(integrationApiPort),
        AUTH_SECRET: sharedApiAuthSecret,
        API_CORS_ORIGIN: 'http://localhost:3000',
        AUTH_RATE_LIMIT_MAX_REQUESTS: '100000',
        AUTH_RATE_LIMIT_IDENTIFIER_MAX_REQUESTS: '100000',
        TX_STORAGE_MODE: process.env.TX_STORAGE_MODE ?? 'memory',
        ...stripeIntegrationTestEnvOverrides(process.env),
        // Sized for CONCURRENT stress integration tests overlapping within
        // a slot (e.g. billing-stale-reclaim-race's 100-parallel reclaim
        // running at the same time as billing-suspended-at-concurrency's
        // 25-parallel setSuspended). 100 was observed producing transient
        // createUser timeouts during that overlap. Coordinated with
        // docker-compose.yml postgres max_connections=1000:
        //   4 worker slots × (150 API + 40 worker) = 760, room to spare.
        DB_POOL_MAX: '150'
      },
      stdio: ['ignore', apiLogFd, apiLogFd],
      // Detach + unref so the server survives vitest's SIGTERM and the
      // next invocation can reuse it via apiLockfilePath.
      detached: true
    }
  )
  apiProcess.unref()
  closeSync(apiLogFd)

  // Wait for health
  const maxWait = 30_000
  const start = Date.now()
  let healthy = false

  while (Date.now() - start < maxWait) {
    if (apiProcess.exitCode !== null) {
      const log = existsSync(apiLogfilePath) ? readFileSync(apiLogfilePath, 'utf8') : '(no log)'
      throw new Error(
        `Shared API exited with code ${apiProcess.exitCode} before becoming healthy.\n\n${log}`
      )
    }
    try {
      const res = await fetch(`${integrationApiBaseUrl}/health`)
      if (res.ok) { healthy = true; break }
    } catch { /* not ready */ }
    await sleep(500)
  }

  if (!healthy) {
    apiProcess.kill('SIGTERM')
    const log = existsSync(apiLogfilePath) ? readFileSync(apiLogfilePath, 'utf8') : '(no log)'
    throw new Error(
      `Shared API did not become healthy within ${maxWait}ms on ${integrationApiBaseUrl}.\n\n${log}`
    )
  }

  process.env.INTEGRATION_API_PORT = String(integrationApiPort)
  process.env.INTEGRATION_API_BASE_URL = integrationApiBaseUrl
  process.env.INTEGRATION_AUTH_SECRET = sharedApiAuthSecret
  process.env.TX_INTEGRATION_SHARED_API_READY = '1'

  if (apiProcess.pid !== undefined) {
    writeLockFile(apiLockfilePath, {
      pid: apiProcess.pid,
      startedAt: Date.now(),
      port: integrationApiPort,
      stripeMode: stripeIntegrationTestMode
    })
  }

  return apiProcess
}

const stopSharedApiServer = async (apiProcess: ChildProcess): Promise<void> => {
  // Persistent-across-runs pattern: on teardown we do NOT kill the spawned
  // server. The detached child stays alive on the port under its lockfile
  // so the NEXT invocation's tryReuseSharedApiServer() can pick it up.
  // Only clean up when the process is already dead (noop); fresh spawns
  // AND reused stubs are left alone.
  if (!apiProcess.pid || apiProcess.exitCode !== null) { return }
  await sleep(0)
}

// ---------------------------------------------------------------------------
// 5. Shared integration Temporal worker
// ---------------------------------------------------------------------------
const tryReuseSharedWorker = (): ChildProcess | null => {
  if (process.env.TX_FORCE_FRESH_INTEGRATION_SETUP === '1') {
    return null
  }
  const lock = readLockFile(workerLockfilePath)
  if (!lock || !pidAlive(lock.pid)) {
    return null
  }
  if (lock.stripeMode !== stripeIntegrationTestMode) {
    terminateLockedProcess(
      lock,
      `Stripe mode changed (${lock.stripeMode ?? 'unknown'} -> ${stripeIntegrationTestMode})`
    )
    return null
  }
  // Same source staleness gate as the API — the worker loads activity +
  // workflow code at startup, any edit to apps/** or packages/** means the
  // detached worker is executing stale compiled code against fresh tests.
  const newestSourceMtimeMs = getNewestSourceMtimeMs()
  if (newestSourceMtimeMs > lock.startedAt) {
    terminateLockedProcess(
      lock,
      `source files newer than shared worker lock (newest=${new Date(newestSourceMtimeMs).toISOString()}, started=${new Date(lock.startedAt).toISOString()})`
    )
    return null
  }
  process.stderr.write(`[globalSetup] Reusing shared Temporal worker pid=${lock.pid}\n`)
  const stub = { pid: lock.pid, exitCode: null, kill: () => false } as unknown as ChildProcess
  return stub
}

const startSharedWorker = async (): Promise<ChildProcess> => {
  const reused = tryReuseSharedWorker()
  if (reused) { return reused }

  const workerCwd = resolve(projectRoot, 'apps/worker')
  const workerEntryPath = resolve(workerCwd, 'src/index.ts')

  if (!existsSync(workerEntryPath)) {
    throw new Error(`Cannot start shared integration worker. Missing: ${workerEntryPath}`)
  }

  const workerLogFd = openLogFd(workerLogfilePath)
  const workerProcess = spawn(
    process.execPath,
    ['--import', 'tsx', workerEntryPath],
    {
      cwd: workerCwd,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        AUTH_SECRET: sharedApiAuthSecret,
        TX_STORAGE_MODE: process.env.TX_STORAGE_MODE ?? 'memory',
        ...stripeIntegrationTestEnvOverrides(process.env),
        // Worker concurrency is lower than API but still benefits from
        // headroom when multiple workflows run in parallel across slots.
        // 40 × 4 slots = 160, fits under the 1000 ceiling alongside the
        // API's 600.
        DB_POOL_MAX: '40'
      },
      stdio: ['ignore', workerLogFd, workerLogFd],
      // Detach + unref so the worker survives vitest SIGTERM and the
      // next invocation can reuse it via workerLockfilePath.
      detached: true
    }
  )
  workerProcess.unref()
  closeSync(workerLogFd)

  // Wait for the worker to start. The current worker log line is
  // "Temporal worker started.", while older branches used plural wording.
  // Accept both so the readiness check does not false-timeout and leave
  // integration runs thinking they continued without a worker.
  const maxWait = 10_000
  const start = Date.now()
  let started = false

  const readWorkerLog = (): string => {
    try {
      return readFileSync(workerLogfilePath, 'utf8')
    } catch {
      return ''
    }
  }
  while (Date.now() - start < maxWait) {
    if (workerProcess.exitCode !== null) {
      // Worker exited — not fatal, some setups may not have Temporal running.
      // Log and continue without worker.
      process.stderr.write(
        `[globalSetup] Worker exited with code ${workerProcess.exitCode} — continuing without worker.\n`
      )
      return workerProcess
    }
    const workerLog = readWorkerLog()
    if (
      workerLog.includes('Temporal worker started') ||
      workerLog.includes('Temporal workers started')
    ) {
      started = true
      break
    }
    await sleep(250)
  }

  if (!started && workerProcess.exitCode === null) {
    process.stderr.write(
      `[globalSetup] Worker did not start within ${maxWait}ms — continuing without worker.\n` +
      readWorkerLog().slice(0, 500) + '\n'
    )
  }

  if (workerProcess.pid !== undefined) {
    writeLockFile(workerLockfilePath, {
      pid: workerProcess.pid,
      startedAt: Date.now(),
      stripeMode: stripeIntegrationTestMode
    })
  }

  return workerProcess
}

const stopSharedWorker = async (workerProcess: ChildProcess): Promise<void> => {
  // Persistent-across-runs pattern — see stopSharedApiServer. Leave the
  // worker alive for the next invocation to reuse via workerLockfilePath.
  if (!workerProcess.pid || workerProcess.exitCode !== null) { return }
  await sleep(0)
}

// ---------------------------------------------------------------------------
// 6. Export: globalSetup entry point
// ---------------------------------------------------------------------------
export default async () => {
  process.env.AUTH_BCRYPT_ROUNDS ??= '4'

  await assertDockerInfraHealthy()
  runGlobalIntegrationSetup()
  hydrateRedisIntegrationEnv()
  const fakeOpenRouterServer = await startFakeOpenRouterServer()
  try {
    const sharedApiProcess = await startSharedApiServer()
    const sharedWorkerProcess = await startSharedWorker()

    return async () => {
      await stopSharedWorker(sharedWorkerProcess)
      await stopSharedApiServer(sharedApiProcess)
      await closeServer(fakeOpenRouterServer)
    }
  } catch (error) {
    await closeServer(fakeOpenRouterServer)
    throw error
  }
}
