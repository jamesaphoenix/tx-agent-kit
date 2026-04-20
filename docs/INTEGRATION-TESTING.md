# Integration Testing Harness

How `pnpm test:integration` is wired end-to-end, why it's structured this way,
and the caching / invalidation rules that let it run in ~28s warm / ~38s cold
without ever running tests against stale code.

- [TL;DR](#tldr)
- [Architecture](#architecture)
- [The perf journey (129s → 28s)](#the-perf-journey-129s--28s)
- [Shared persistent API + worker (lockfile reuse)](#shared-persistent-api--worker-lockfile-reuse)
- [mtime-based staleness invalidation](#mtime-based-staleness-invalidation)
- [Detached stdio: why we use log-file fds, not pipes](#detached-stdio-why-we-use-log-file-fds-not-pipes)
- [Teardown as a pure no-op](#teardown-as-a-pure-no-op)
- [Parallel git worktree isolation](#parallel-git-worktree-isolation)
- [Lifecycle: when persistent processes go up / down](#lifecycle-when-persistent-processes-go-up--down)
- [Parallelism controls](#parallelism-controls)
- [`describe.concurrent` — when to use it, when to avoid it](#describeconcurrent--when-to-use-it-when-to-avoid-it)
- [Shared fixtures](#shared-fixtures)
- [Recency markers (DB reset + observability preflight)](#recency-markers-db-reset--observability-preflight)
- [Debugging knobs](#debugging-knobs)

## TL;DR

| Phase | Wall-clock | Notes |
|---|---|---|
| Pre-optimisation (baseline) | 129s | Over 120s budget, 2 flaky tests |
| Warm (steady state) | **28-31s** | API+worker reused, DB reset skipped, observability preflight skipped |
| Cold (forced fresh) | ~38s | First run of the day, after `TX_FORCE_FRESH_INTEGRATION_SETUP=1`, after >1h idle |

- One shared API server + one Temporal worker + one Postgres schema **per git worktree** — invariant preserved.
- 582 tests pass, 20 intentionally skipped. Nothing moved behind a CI-only gate.
- Warm reuse is guarded by a whole-tree **mtime staleness check** against `apps/**` + `packages/**` — editing any source file forces a fresh spawn before tests can see the old code.
- Parallel worktrees can run integration tests simultaneously without contention: lockfiles embed `sha1(absolute-project-root)`, DB schemas are per-worktree (`wt_<name>`), ports offset by `WORKTREE_PORT_OFFSET`, Temporal task queues suffixed by worktree name.

Full research trail and decision log: `~/Desktop/integration-test-perf-research.md` (14 experiments, all committed individually so any change is revertable).

## Architecture

### Per-worktree layout

```
┌──────────────────────────────────────────────────────────────────┐
│  worktree: .worktrees/<name>/                                    │
│                                                                  │
│  ┌────────────────┐   reuses   ┌─────────────────────────────┐   │
│  │ vitest workers │────────────▶  Persistent API (port 4100  │   │
│  │   (pool=10)    │            │      + WORKTREE_PORT_OFFSET) │   │
│  └────────────────┘            └─────────────────────────────┘   │
│          │                                   │                  │
│          │                                   │                  │
│          ▼                                   ▼                  │
│  ┌────────────────┐            ┌─────────────────────────────┐   │
│  │ Per-test SQL   │            │ Persistent Temporal worker  │   │
│  │ context        │            │ (task queue:                │   │
│  │ (testkit)      │            │  tx-agent-kit-<worktree>)   │   │
│  └────────────────┘            └─────────────────────────────┘   │
│          │                                   │                  │
└──────────┼───────────────────────────────────┼──────────────────┘
           │                                   │
           ▼                                   ▼
  ┌──────────────────────────────────────────────────────────┐
  │  Shared Docker infra (single instance across worktrees)  │
  │  - Postgres (schema per worktree: wt_<name>)             │
  │  - Redis                                                 │
  │  - Temporal dev server (shared, task queues isolated)    │
  │  - Jaeger / Prometheus / Loki / Grafana / OTEL           │
  └──────────────────────────────────────────────────────────┘
```

### Test-file → API routing

Each vitest test file uses `createDbAuthContext(...)` from `@tx-agent-kit/testkit`.
It returns:

1. `baseUrl` — the shared API server's HTTP URL (e.g. `http://127.0.0.1:4872`).
2. `testContext` — a `SqlTestContext` with a `withSchemaClient()` helper.
3. Factories (`createUser`, `createOrganization`, `createInvitation`, etc) that
   hit the shared API server via HTTP.

The HTTP factories land their data in the worktree's Postgres schema (`wt_<name>`)
because the persistent API process was booted with `DATABASE_URL` pointing at that
schema. The `withSchemaClient()` helper uses a `search_path` fallback chain
(`[test-schema, wt_<name>, public]`) so raw SQL reads and writes round-trip to
the same physical rows the API sees. Per-test data isolation is achieved not by
per-test schemas (those are empty artefacts) but by **unique identifiers** — every
test uses `randomUUID()`-prefixed emails, org names, and ids so concurrent tests
don't collide.

**Why not per-test schemas with their own API servers?** That was the original
design. It's correct but slow: each test file paid ~5s of fork + import + API
boot. Shared API + unique-id isolation cuts that to ~0s per file.

### Files of interest

| Concern | File |
|---|---|
| Global setup entry | `scripts/test/vitest-global-setup.ts` |
| Workspace project list | `vitest.integration.workspace.ts` |
| Integration vitest base config | `packages/tooling/vitest-config/integration.ts` |
| Worker count helper | `packages/tooling/vitest-config/workers.ts` |
| Quiet wrapper (preflight + timeout) | `scripts/test-integration-quiet.sh` |
| DB reset pipeline | `scripts/test/reset-test-db.sh` |
| Testkit db-auth context | `packages/testkit/src/db-auth-context.ts` |
| Testkit sql context | `packages/testkit/src/sql-context.ts` |

## The perf journey (129s → 28s)

Seven levers stacked on top of each other. Each is independent — you could apply
any subset to a different project and the wins would stack the same way.

| # | Lever | Delta | What it is |
|---|---|---|---|
| 1 | Worker ready-log typo | **-59s** | `globalSetup` polled for `"Temporal worker started"` but the worker logs `"Temporal workers started."` (plural + period). The match never hit → full 60s busy-wait per run. |
| 2 | Parallelise the mobile project | **-18s** | JSON-reporter inspection showed 8 mobile files running one-at-a-time in a lone fork, gated behind `sequence.groupOrder:2` so they only started AFTER every other project finished. ~20s of serial tail hiding from the slow-test threshold. Fix: share `maxWorkers` with other projects, `fileParallelism:true`, drop the groupOrder. |
| 3 | Persistent API + worker (lockfile reuse) | **-10s (warm)** | Spawn detached, stdio→log-file fd, write `{pid, port, startedAt}` to a per-worktree lockfile, reuse via `kill(pid,0)` + `/health`. Saves the ~5s cold-boot per run when consecutive runs find a live server. |
| 4 | DB reset recency marker | -6s | `reset-test-db.sh` is idempotent between runs. Skip when a marker at `/tmp/tx-agent-db-reset-<hash>.marker` is younger than 1h AND no migration/schema file is newer. |
| 5 | Observability preflight recency marker | -4s | Same pattern for the `pnpm test:infra:observability` smoke check. |
| 6 | `describe.concurrent` on I/O-bound route/integration files | -4s cumulative | `tenancy-model`, `billing-routes`, `organizations`. See [describe.concurrent guidance](#describeconcurrent--when-to-use-it-when-to-avoid-it) for the rules. |
| 7 | Shared fixtures + stress-N parameter tuning | -2s + latent | `media/page.integration.test.tsx` hoisted owner+org+subscription to `beforeAll` (4 HTTP calls → 1, then per-test team). `billing-stale-reclaim-race` N parameterised (`CI=true` → 100, local → 20). |
| 8 (safety) | Source-mtime staleness gate on the reuse paths | 0s (correctness) | Added in follow-up. Prevents #3 from ever silently running tests against stale compiled code after an edit to `apps/**` or `packages/**`. |

The three that moved the needle most were `#1`, `#2`, and `#3` — a literal typo,
a visualisation bug that was only visible on a JSON-reporter timeline, and a
stateful-process reuse pattern with three subtleties (all documented below).

## Shared persistent API + worker (lockfile reuse)

**Goal:** make `globalSetup` cheap between consecutive test runs by keeping the
API + worker processes alive across vitest invocations, without compromising
correctness when source code changes.

### Lockfile shape

Two lockfiles per worktree, under `os.tmpdir()`:

```
tx-agent-shared-api-<offset>-<sha1(projectRoot)>.lock
tx-agent-shared-worker-<offset>-<sha1(projectRoot)>.lock
```

Contents (JSON):

```json
{
  "pid": 84181,
  "startedAt": 1776258403614,
  "port": 4872
}
```

- `<offset>` — `WORKTREE_PORT_OFFSET` from the worktree `.env` (0 for the primary).
- `<sha1(projectRoot)>` — first 8 chars of `sha1(absolute-path-of-the-checkout)`.
  Guarantees two filesystem checkouts can't share a lockfile, and a recycled
  `WORKTREE_PORT_OFFSET` from a deleted worktree can't inherit a stale reference.
- `startedAt` — epoch milliseconds of the fresh spawn. Used by the
  [mtime staleness gate](#mtime-based-staleness-invalidation).
- `port` — recorded explicitly so reuse aborts if the worktree port offset changed
  between runs.

### Reuse path (happy path, ~warm)

```ts
// pseudocode — see scripts/test/vitest-global-setup.ts
const lock = readLockFile(apiLockfilePath)
if (!lock)                                 return null  // no lockfile → fresh spawn
if (lock.port !== integrationApiPort)      return null  // env drift
if (!pidAlive(lock.pid))                   return null  // ESRCH → dead PID
if (newestSourceMtimeMs > lock.startedAt)  return null  // source newer → stale
try {
  const controller = new AbortController()
  setTimeout(() => controller.abort(), 1_000)
  const res = await fetch(`${baseUrl}/health`, { signal: controller.signal })
  if (!res.ok) return null                 // unhealthy → fresh spawn
} catch { return null }                    // couldn't connect → fresh spawn
return stubChildProcess(lock.pid)          // reuse — stub has pid + exitCode:null
```

`pidAlive` uses the classic signal-0 trick — `process.kill(pid, 0)` throws
`ESRCH` if the PID is gone, otherwise is a no-op.

### Fresh spawn path

```ts
// Kill any zombie on the port first (only runs when reuse path returned null)
execFileSync('bash', ['-c',
  `lsof -ti :${integrationApiPort} | xargs kill -9 2>/dev/null`
], { stdio: 'ignore' })

const apiLogFd = openSync(apiLogfilePath, 'w')  // truncate on fresh spawn
const apiProcess = spawn(process.execPath, ['--import', 'tsx', 'apps/api/src/server.ts'], {
  cwd: 'apps/api',
  env: { ...process.env, NODE_ENV: 'test', API_PORT, AUTH_SECRET, DB_POOL_MAX: '150' },
  stdio: ['ignore', apiLogFd, apiLogFd],
  detached: true,
})
apiProcess.unref()
closeSync(apiLogFd)

// Poll /health until it answers 200 (30s budget)
// On success, writeLockFile({pid, port, startedAt: Date.now()})
```

The stdio fd + detach pattern is the most subtle part — see the two sections below.

## mtime-based staleness invalidation

### The problem it solves

The persistent API was spawned via `tsx` running `apps/api/src/server.ts`. `tsx`
is a TypeScript runner, not a hot-reload watcher. Once the process loads its
module graph, it's frozen — any edit to `packages/core/src/billing-service.ts`
will NOT be seen by the running server. Without a staleness check, your new test
file runs against the OLD compiled code and you get a silent correctness bug.

### The mechanic

Every file on the filesystem has an `mtime` (modification time) that the kernel
updates whenever the content changes (or you `touch` it). On globalSetup we walk
the source tree, take `max(mtime)` across all files, and compare against
`lock.startedAt`. If anything is newer, the lock is stale.

```ts
const newestSourceMtimeMs = getNewestSourceMtimeMs()
if (newestSourceMtimeMs > lock.startedAt) {
  process.stderr.write(
    `[globalSetup] Source files newer than shared API lock ` +
    `(newest=${new Date(newestSourceMtimeMs).toISOString()}, ` +
    `started=${new Date(lock.startedAt).toISOString()}) — respawning.\n`
  )
  return null  // force fresh spawn
}
```

### Two scopes, two caches

Walking twice would be wasteful, so we cache each result per globalSetup
invocation (globalSetup runs once at the start of every vitest run):

```ts
let cachedNewestSourceMtimeMs: number | undefined
const getNewestSourceMtimeMs = () => {
  if (cachedNewestSourceMtimeMs !== undefined) return cachedNewestSourceMtimeMs
  cachedNewestSourceMtimeMs = walkForNewestMtimeMs([
    resolve(projectRoot, 'apps'),
    resolve(projectRoot, 'packages')
  ])
  return cachedNewestSourceMtimeMs
}

let cachedNewestDbMtimeMs: number | undefined
const getNewestDbMtimeMs = () => {
  if (cachedNewestDbMtimeMs !== undefined) return cachedNewestDbMtimeMs
  cachedNewestDbMtimeMs = walkForNewestMtimeMs([
    resolve(projectRoot, 'packages/infra/db/drizzle/migrations'),
    resolve(projectRoot, 'packages/infra/db/schemas'),
    resolve(projectRoot, 'packages/infra/db/pgtap')
  ])
  return cachedNewestDbMtimeMs
}
```

- `getNewestSourceMtimeMs()` → gates **API + worker reuse**. Any change in
  `apps/**` or `packages/**` forces both servers to respawn, because any code in
  those trees can influence server behaviour.
- `getNewestDbMtimeMs()` → gates the **`reset-test-db.sh` recency marker**.
  Narrower so a `.tsx` edit doesn't re-pay ~10s of migrate + reset + schemas
  when only UI code changed. Note that because `packages/infra/db/**` is a
  subset of `packages/**`, touching a migration also trips the source walk and
  respawns the API — which is the right call because the API's drizzle client
  caches column metadata at module load.

### Walk implementation

```ts
const ignoredDirNamesForMtimeWalk = new Set([
  'node_modules', 'dist', '.next', '.turbo', '.vercel',
  'coverage', 'out', '.expo', '.git'
])

const walkForNewestMtimeMs = (roots: readonly string[]): number => {
  let newest = 0
  const stack: string[] = roots.filter(existsSync).slice()
  while (stack.length > 0) {
    const dir = stack.pop()!
    let entries: Dirent[]
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      const name = String(entry.name)
      if (entry.isDirectory()) {
        if (ignoredDirNamesForMtimeWalk.has(name)) continue
        stack.push(resolve(dir, name))
        continue
      }
      if (!entry.isFile()) continue
      try {
        const st = statSync(resolve(dir, name))
        if (st.mtimeMs > newest) newest = st.mtimeMs
      } catch { /* ignore transient stat errors */ }
    }
  }
  return newest
}
```

Iterative DFS, no recursion, single `readdirSync(withFileTypes:true)` per
directory so file-type checks don't cost extra stat calls. Cost: ~10-30ms for
the whole monorepo.

### Why mtime, not content hash

- mtime is a free kernel lookup; content hashing is ~100-500ms.
- mtime has false positives (`git checkout` updates mtimes even when content is
  byte-identical) but every false positive is "unnecessary respawn, still correct."
- Never a false negative: if content changed, mtime changed.

### Why extension-agnostic

The walk counts every file type — `.ts`, `.tsx`, `.sql`, `.json`, `.yaml`,
`.toml`, `.prisma`, whatever. Listing specific extensions invites drift every
time a new tool, schema format, or config language enters the repo. The "cost"
of the broader walk is zero (mtime checks are free) and the safety margin is
large.

## Detached stdio: why we use log-file fds, not pipes

**Fact one:** when Node spawns a child process, the `stdio` option controls
where the child's stdin/stdout/stderr are connected. Four common values:

```ts
stdio: 'inherit'                           // child writes to parent's terminal
stdio: 'pipe'                              // stdout/stderr become streams the parent reads
stdio: ['ignore', 'pipe', 'pipe']          // stdin ignored, stdout+stderr as pipes
stdio: ['ignore', <fd>, <fd>]              // stdout+stderr write to a raw file descriptor
```

**Fact two:** when you `stdio: 'pipe'`, the OS creates a pipe with a read end
(owned by the parent) and a write end (owned by the child). When the child
writes, bytes flow through the pipe into the parent's stream.

### What I started with (broken)

```ts
const apiProcess = spawn(process.execPath, [...], {
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true,
})
apiProcess.unref()

const apiOutput: string[] = []
apiProcess.stdout?.on('data', (chunk: Buffer) => apiOutput.push(chunk.toString('utf8')))
apiProcess.stderr?.on('data', (chunk: Buffer) => apiOutput.push(chunk.toString('utf8')))
```

Looks right. Is wrong. When vitest exits, Node closes its pipe file descriptors.
The child's write end of the pipe is still open, but the kernel now sees the
read end has gone away. The next time the child calls `write()` it gets `EPIPE`.
Most programs crash on EPIPE (or their logger explodes internally). So the
"detached" child lives for a few seconds until it tries to log something, then
dies.

Verified directly after the first attempt: `lsof -ti :4872` returned nothing.
The server we thought we were preserving was already dead.

### What we use (works)

```ts
const apiLogFd = openSync(apiLogfilePath, 'w')  // truncate + write mode
const apiProcess = spawn(process.execPath, [...], {
  stdio: ['ignore', apiLogFd, apiLogFd],
  detached: true,
})
apiProcess.unref()
closeSync(apiLogFd)  // parent releases its reference; child still holds it
```

Key difference: `stdio: ['ignore', apiLogFd, apiLogFd]` wires the child's
stdout+stderr to an **OS file descriptor pointing at a regular file on disk**.
When the child writes, bytes go straight to the file — the kernel doesn't need
the parent alive at all. After `spawn()` returns, the parent calls
`closeSync(apiLogFd)` to drop its own reference; the child has the only
reference left and keeps writing to the file for its entire lifetime.

### Diagnostics stay readable

Because the log is a real file, we can read it later for error messages:

```ts
if (!healthy) {
  const log = existsSync(apiLogfilePath) ? readFileSync(apiLogfilePath, 'utf8') : '(no log)'
  throw new Error(`Shared API did not become healthy within ${maxWait}ms.\n\n${log}`)
}
```

The worker uses the same trick — instead of listening on a pipe for the
`"Temporal workers started"` ready marker, it re-reads the log file on each poll:

```ts
const readWorkerLog = () => {
  try { return readFileSync(workerLogfilePath, 'utf8') } catch { return '' }
}
while (Date.now() - start < 10_000) {
  if (readWorkerLog().includes('Temporal workers started')) { started = true; break }
  await sleep(250)
}
```

### What "fd" actually is

In Unix, when a process opens a file (or pipe, or socket), the kernel hands back
an integer called a **file descriptor**. Each process has its own table: fd 0 is
stdin, fd 1 is stdout, fd 2 is stderr, and `openSync()` returns a fresh integer
(say, 17). `stdio: [..., 17, 17]` tells Node: "wire the child's fd 1 and fd 2 to
my fd 17." At `spawn()` time the kernel duplicates fd 17 into the child's fd 1
and fd 2, and after that both processes can `closeSync(17)` independently —
whoever still has an open reference keeps the underlying file open.

## Teardown as a pure no-op

`vitest`'s `globalSetup` is expected to return a teardown function:

```ts
export default async () => {
  const apiProcess = await startSharedApiServer()
  const workerProcess = await startSharedWorker()
  return async () => {
    // this runs when vitest exits
    await stopSharedWorker(workerProcess)
    await stopSharedApiServer(apiProcess)
  }
}
```

### What "normal" teardown looks like

The textbook "clean up what you spawned" version:

```ts
const stopSharedApiServer = async (apiProcess: ChildProcess) => {
  if (apiProcess.exitCode !== null) return  // already dead, nothing to do
  apiProcess.kill('SIGTERM')
  await waitFor(() => apiProcess.exitCode !== null, 5_000)
  try { apiProcess.kill('SIGKILL') } catch {}  // hard kill if SIGTERM didn't take
}
```

**This is exactly what breaks the persistent-server pattern.** Every vitest run
would spawn → test → SIGTERM its own server → exit. Next run sees no server
and spawns again. Zero reuse.

### What we actually use

```ts
const stopSharedApiServer = async (apiProcess: ChildProcess): Promise<void> => {
  // Persistent-across-runs pattern: on teardown we do NOT kill the spawned
  // server. The detached child stays alive on the port under its lockfile
  // so the NEXT invocation's tryReuseSharedApiServer() can pick it up.
  // Only clean up when the process is already dead (noop); fresh spawns
  // AND reused stubs are left alone.
  if (!apiProcess.pid || apiProcess.exitCode !== null) return
  await sleep(0)  // preserve Promise<void> signature vitest expects
}
```

The function takes the `ChildProcess` handle, early-returns if it's already dead
(nothing to clean up), and then **does literally nothing**. No SIGTERM, no
SIGKILL. Returns control to vitest. The child process keeps running. Worker has
the mirror version.

### Who cleans up the zombies?

Three mechanisms, in order of how often they fire:

1. **Lockfile convergence + port-kill on fresh spawn** (every code edit).
   When the mtime gate invalidates the reuse path, we `lsof -ti :${port} | xargs
   kill -9` before spawning. That deliberate kill ensures at most one server
   lives on each port at any moment, cleaning up the previous generation.
2. **OS process lifecycle** (every machine reboot). macOS reboots kill all
   processes. The lockfile may survive on `/tmp` but `pidAlive()` catches the
   dead PID and the next run spawns fresh.
3. **Manual** (rare). `TX_FORCE_FRESH_INTEGRATION_SETUP=1`, or
   `lsof -ti :<port> | xargs kill -9`, or `pkill -f vitest-global-setup` if you
   want a clean slate.

Steady state: one detached API + one detached worker per worktree, persisting
until their code changes or the machine reboots. That's the intended lifecycle.

### Why we dropped the `isReused` flag

An earlier iteration used a `Symbol('tx-reused-process')` tag to distinguish
stub handles (from `tryReuseSharedApiServer`) from fresh spawns, and the
teardown checked the flag to skip killing reused stubs while still killing fresh
spawns. Once the mtime gate landed, that distinction became pointless — BOTH
cases want the process to survive. The whole `markReused`/`isReused`/
`reusedProcessSymbol` machinery was dead code and was removed in experiment_014.
The current teardown is unconditionally a no-op.

## Parallel git worktree isolation

Every isolation boundary is scoped via one of three inputs:

| Resource | Scope key | How it's isolated |
|---|---|---|
| API + worker port | `WORKTREE_PORT_OFFSET` | `4100 + offset` per worktree |
| Lockfiles (api/worker) | `<offset>-<sha1(projectRoot)>` | Can't share even if an offset is recycled |
| DB reset marker | `<sha1(projectRoot)>` | Per-worktree |
| Postgres schema | `DATABASE_SCHEMA=wt_<name>` | Each worktree owns its own schema in the shared Postgres |
| Temporal task queue | `TEMPORAL_TASK_QUEUE` in `.env` | `tx-agent-kit-<worktree>` → workers don't cross-pollinate |
| DB reset script race | `flock` on `/tmp/<compose-project>-db-reset.lock` | Concurrent resets serialise, not corrupt |

What is **intentionally shared** across worktrees:

- Docker infra (Postgres, Redis, Temporal dev server, Jaeger, Loki, OTEL, Grafana,
  Spotlight). Started once via `pnpm infra:ensure` and kept alive across worktrees.
- Observability preflight marker (scoped by `COMPOSE_PROJECT_NAME`, not by worktree).
  The marker validates the infra, and the infra IS shared.

The primary checkout (main/staging) works the same way: `WORKTREE_PORT_OFFSET`
defaults to `0`, `projectRootHash` is different from any worktree's hash, so
it owns its own persistent server on port 4100 and coexists peacefully with any
number of worktree sessions on higher port offsets.

### The one race that's NOT safe

Running integration tests **in the same checkout from two terminals at once** is
not parallel-safe during a cold spawn. Both sessions see the same lockfile, both
try to reuse the same PID, and both fall through to `lsof -ti | kill -9` →
spawn. The second `kill -9` takes out the first spawn mid-boot. In practice
nobody does this, but if you want to, space the invocations a couple of seconds
apart or run them from different worktrees.

## Lifecycle: when persistent processes go up / down

### When they spawn (fresh start)

1. **First run after a machine reboot.** Lockfile may still be on `/tmp`, but
   `pidAlive(lock.pid)` returns false → fresh spawn.
2. **First run in a fresh worktree** (no lockfile yet).
3. **First run after `TX_FORCE_FRESH_INTEGRATION_SETUP=1`**.
4. **First run after an edit to any file under `apps/**` or `packages/**`**.
   mtime gate → fresh spawn.
5. **First run after the server crashes on its own** (unhandled exception,
   OOM, SIGSEGV from a native dep). `pidAlive()` returns false → fresh spawn.
6. **First run after someone manually killed the server** on its port
   (`lsof -ti :<port> | xargs kill`). `/health` check fails → fresh spawn.
7. **Port conflict.** Another process squatting on the port. Reuse fails because
   `/health` can't connect → `lsof -ti | kill -9` → spawn the real thing.

### When they keep running (reuse)

Every run where none of the above trip. The steady-state behaviour on a quiet
dev loop is: run integration tests, edit a test file (not an impl file), run
again, both reuse → ~28s wall-clock. As soon as you touch impl code, the next
run respawns once and every run after that reuses the new process.

### What does NOT take them down

- `pnpm test:integration:quiet` exiting normally (teardown is a no-op).
- vitest crashing or being Ctrl-C'd mid-run. The child is `detached: true` +
  `unref()`'d, stdio goes to a log file not a pipe, so vitest's death doesn't
  cascade.
- Another vitest invocation in parallel against the same worktree. Both reuse
  the same PID. The API server itself is stateless HTTP — concurrent requests
  are its normal mode.
- A sibling git worktree running its own tests. Lockfile hash + port offset
  guarantee no collision.

## Parallelism controls

Defined in `packages/tooling/vitest-config/workers.ts`:

```ts
const fallbackWorkerCount = 1
const maxAutoIntegrationWorkers = 10
const maxAutoWebIntegrationWorkers = 8
```

| Env var | Default | Purpose |
|---|---|---|
| `INTEGRATION_MAX_WORKERS` | `min(availableParallelism(), 10)` | Integration worker cap |
| `WEB_INTEGRATION_MAX_WORKERS` | `min(INTEGRATION_MAX_WORKERS, 8)` | Web integration sub-cap |
| `TEST_MAX_WORKERS` | `availableParallelism()` | Unit test worker cap |
| `INTEGRATION_TIMEOUT_SECONDS` | `120` local / `300` CI | Hard wall-clock budget for the quiet runner |
| `SLOW_TEST_THRESHOLD_MS` | `10000` | Report tests slower than this |
| `INTEGRATION_TEST_TIMEOUT_MS` | `30000` local / `60000` CI | Per-test timeout |
| `INTEGRATION_INCLUDE_CI_ONLY` | unset locally | Include command-entrypoints + start-dev-services suites |
| `DB_POOL_MAX` | `150` API / `40` worker | Postgres connection cap per process |

Pool settings at the integration base (`packages/tooling/vitest-config/integration.ts`):

```ts
test: {
  pool: 'threads',
  isolate: false,
  fileParallelism: integrationMaxWorkers > 1,
}
```

`threads` + `isolate:false` means files within a worker share a module graph
instead of each forking fresh — amortises the ~2.7s/worker import cost across a
worker's lifetime.

### Worker count sweet spot

On a 16-CPU box, 10 is the sweet spot for integration tests. Raising to 14
regressed by 2s (more workers pay more per-worker import amortisation than they
save in parallelism). Lowering to 6 (the old default) regressed by ~2s in the
other direction. Empirical — see exp-007 and exp-012 in the research log.

### vitest project `groupOrder` gotcha

vitest workspace mode errors if projects sharing a `sequence.groupOrder` have
different `maxWorkers`. If you need a project-specific worker cap, either:

- Give it a unique `groupOrder` (but then it runs in its own serial phase —
  usually bad for parallelism), **or**
- Import `resolveIntegrationMaxWorkers` from `@tx-agent-kit/vitest-config/workers`
  and set `maxWorkers: resolveIntegrationMaxWorkers()` so it matches the rest.

`apps/mobile/vitest.integration.config.ts` uses the second form — it has to
keep `pool: 'forks'` + `isolate: true` for the `react-native` mock, but it's
otherwise aligned with every other integration project.

## `describe.concurrent` — when to use it, when to avoid it

`vitest`'s top-level `describe.concurrent(...)` overlaps all `it()` blocks
inside the describe, including nested describes. Since integration tests are
I/O-bound waiting on the shared API server, this is a cheap speedup for any
file where tests don't share mutable state.

### Use it when

- **Each test creates its own user/org/etc via factories** with unique email
  prefixes (e.g. `createUser({ email: 'billing-authz-owner-${uid}@…' })`).
- **Module-level state is immutable** — destructured helpers, random UUIDs
  assigned once at file load.
- **No shared admin/auth helper** that caches tokens across tests.

Files that got the treatment and stayed:

- `apps/api/src/tenancy-model.integration.test.ts` (44 tests, 17s → 7s
  standalone)
- `apps/api/src/routes/billing.integration.test.ts` (23 tests)
- `apps/api/src/routes/organizations.integration.test.ts` (15 tests)

### Do NOT use it on

1. **React/jsdom rendering tests.** `renderWithProviders` mounts into the shared
   `document.body` and `@testing-library`'s `cleanup()` races — concurrent
   tests trip "found multiple elements" errors. File-level parallelism across
   workers is fine, but within a file React tests must be serial under
   `pool:threads + isolate:false`.
2. **Files with shared state-ful helpers.** `apps/api/src/routes/email-campaigns*.test.ts`
   uses a `createAdminWithOrg()` helper that caches admin auth state across
   calls — flipping to `.concurrent` failed 19/31 tests with 401s. Reverted.
3. **Auth + rate-limit tests.** Cross-test invariants about token issuance
   windows or request quotas can't be parallelised.

When you revert a `.concurrent` flip, leave a short comment in the file saying
WHY so the next person doesn't re-apply it:

```ts
// NOTE: kept serial. createAdminWithOrg caches admin auth state across tests
// and describe.concurrent broke 19 tests with 401s. See experiment_010 revert.
describe('email campaigns API integration', () => {
```

## Shared fixtures

`vitest`'s `beforeAll` runs once per file; `beforeEach` runs per test. For slow
fixtures that don't need per-test isolation, hoisting to `beforeAll` pays for
itself immediately. See `apps/web/app/(application)/org/[orgId]/[teamId]/media/page.integration.test.tsx`
for the reference pattern:

```ts
let sharedFixture: SharedFixture | undefined

describe('MediaPage integration', () => {
  beforeAll(async () => {
    const factoryContext = createWebFactoryContext()
    const owner = await createUser(factoryContext, { email: ..., password: ..., name: ... })
    writeAuthToken(owner.token)
    const org = await createOrganization(factoryContext, { token: owner.token, name: ... })
    await activateSubscription(org.id)
    const uiTeam = await clientApi.createTeam({ organizationId: org.id, ... })
    sharedFixture = { factoryContext, owner, org, uiTeam }
  })

  // vitest.integration.setup.ts registers a GLOBAL beforeEach that calls
  // clearAuthToken() + window.localStorage.clear() between tests. Re-write the
  // token here AFTER the global reset so each test still starts authenticated.
  beforeEach(() => {
    const { owner } = getSharedFixture()
    writeAuthToken(owner.token)
  })

  // UI-only tests reuse the shared team (they don't mutate state)
  it('renders empty state when team has no assets', async () => {
    const { org, uiTeam: team } = getSharedFixture()
    renderMediaPage(org.id, team.id)
    // ...
  })

  // Data tests get a fresh team per test (they seed assets)
  it('renders asset cards in card view after seeding data', async () => {
    const { owner, org, team } = await createPerTestTeam()
    await seedAsset(owner.token, team.id, 'test-image.png')
    // ...
  })
})
```

Two gotchas when doing this on web integration files:

1. **Global `beforeEach` wipes auth.** `apps/web/vitest.integration.setup.ts`
   has a global `beforeEach` that calls `clearAuthToken() + window.localStorage.clear()`.
   Any token written in `beforeAll` is gone before the first test runs. Re-write
   it in a local `beforeEach` that runs AFTER the global hook.
2. **Decide which tests can share vs which need isolation.** The rule of thumb:
   if the test MUTATES state (uploads, deletes, role changes), it needs its own
   fresh sub-fixture. If it only verifies render state (empty list, toolbar
   buttons, dialog open), it can share.

## Recency markers (DB reset + observability preflight)

Both live under `os.tmpdir()` and use the same pattern: a marker file's `mtime`
represents "last successful run of this work." Skip the work if the marker is
younger than the TTL AND no upstream input is newer than the marker.

### DB reset marker

- Path: `/tmp/tx-agent-db-reset-<sha1(projectRoot)>.marker`
- TTL: 1 hour
- Upstream staleness: `max(mtime)` across
  `packages/infra/db/drizzle/migrations/**`, `packages/infra/db/schemas/**`,
  `packages/infra/db/pgtap/**` (via `getNewestDbMtimeMs()`)
- Overridden by: `TX_FORCE_FRESH_INTEGRATION_SETUP=1`
- What it skips when valid: `pnpm db:migrate` + `render-reset-public-sql.ts` +
  `pnpm db:schemas:apply` (roughly ~6-10s)

### Observability preflight marker

- Path: `/tmp/${COMPOSE_PROJECT_NAME}-observability-preflight.marker`
  (scoped by compose project, NOT by worktree — infra is shared)
- TTL: 1 hour
- Upstream staleness: none (infra doesn't change between runs)
- Overridden by: `TX_FORCE_FRESH_OBSERVABILITY_PREFLIGHT=1` or
  `INTEGRATION_SKIP_OBSERVABILITY=1`
- What it skips when valid: `pnpm test:infra:observability` end-to-end trace
  emission + Jaeger verification (~4.2s)

Only touched on successful runs, so a failing preflight keeps re-running the
check until the infra is fixed.

## Debugging knobs

### Force-fresh toggles

| Env var | Effect |
|---|---|
| `TX_FORCE_FRESH_INTEGRATION_SETUP=1` | Ignore API + worker lockfiles, re-run DB reset, spawn everything fresh |
| `TX_FORCE_FRESH_OBSERVABILITY_PREFLIGHT=1` | Force observability preflight to run even if marker is <1h old |
| `INTEGRATION_SKIP_INFRA_ENSURE=1` | Skip `pnpm infra:ensure` preflight when Docker is known healthy |
| `INTEGRATION_SKIP_OBSERVABILITY=1` | Skip the observability preflight entirely (not recommended) |
| `INTEGRATION_RUN_PGTAP=1` | Run pgTAP inside vitest globalSetup (default: off; use `pnpm test:db:pgtap` instead) |
| `BILLING_STRESS_N=<n>` | Override the stale-reclaim race stress concurrency (default: 20 local, 100 CI) |

### Inspecting persistent server state

```bash
# What PID does the lockfile think is running?
cat "$(python3 -c 'import os; print(os.path.join("/var/folders", "_y", "20jl658s4jl0zvy5c0x0c5140000gn", "T"))')/tx-agent-shared-api-"$((4100 + ${WORKTREE_PORT_OFFSET:-0} - 4100))"*.lock"
# (On macOS the tmpdir is under /var/folders. On Linux it's usually /tmp.)

# What's actually listening on the API port?
lsof -ti :"$((4100 + ${WORKTREE_PORT_OFFSET:-0}))"

# Is the API healthy?
curl -s "http://127.0.0.1:$((4100 + ${WORKTREE_PORT_OFFSET:-0}))/health"

# What's the API server logging?
tail -f "$(node -e 'console.log(require("os").tmpdir())')/tx-agent-shared-api-"*"-"*.log

# Same for worker
tail -f "$(node -e 'console.log(require("os").tmpdir())')/tx-agent-shared-worker-"*"-"*.log
```

### Forcing a full cold run

```bash
# Kills everything and runs from scratch — roughly 38s wall-clock
TX_FORCE_FRESH_INTEGRATION_SETUP=1 \
TX_FORCE_FRESH_OBSERVABILITY_PREFLIGHT=1 \
  pnpm test:integration:quiet
```

### Killing a stuck persistent server manually

```bash
# By port (cleanest)
lsof -ti ":$((4100 + ${WORKTREE_PORT_OFFSET:-0}))" | xargs -r kill -9

# By lockfile PID
pid=$(jq -r .pid "/tmp/tx-agent-shared-api-"*"-"*.lock 2>/dev/null | head -1)
[[ -n "$pid" && "$pid" != "null" ]] && kill -9 "$pid"
```

### When tests pass locally but fail in CI

1. Check `CI=true` defaults — `BILLING_STRESS_N` auto-flips to 100 in CI.
2. Confirm `INTEGRATION_INCLUDE_CI_ONLY=1` if you want to replicate the full CI
   integration run locally (includes `command-entrypoints` + `start-dev-services`
   — 20s+ slower).
3. CI has `INTEGRATION_TEST_TIMEOUT_MS=60000` (double the local default of
   30s); local flakes from slow assertions can hide by coincidence on the
   longer CI budget.
