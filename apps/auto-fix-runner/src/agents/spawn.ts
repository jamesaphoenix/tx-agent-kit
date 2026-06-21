import { spawn } from 'node:child_process'
import type { ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'

/**
 * The agent process we spawn: stdin is `/dev/null` (see `defaultSpawn`), stdout
 * and stderr are pipes we stream. stdin is intentionally `null` — the runners
 * pass the prompt as a positional/`-p` arg and must never touch `child.stdin`.
 */
export type AgentChildProcess = ChildProcessByStdio<null, Readable, Readable>

/**
 * The subset of `node:child_process.spawn` the agent runners depend on.
 * Declaring it as an injectable type lets the unit tests substitute a fake
 * spawn (to assert argv/env construction) without touching real binaries.
 */
export type SpawnFn = (
  command: string,
  args: ReadonlyArray<string>,
  options: { env: Record<string, string>; cwd?: string }
) => AgentChildProcess

export const defaultSpawn: SpawnFn = (command, args, options): AgentChildProcess =>
  spawn(command, [...args], {
    env: options.env,
    ...(options.cwd ? { cwd: options.cwd } : {}),
    // `detached: true` puts the agent in its OWN process group so the abort
    // timeout can kill the WHOLE tree. codex/claude spawn a vendor engine
    // grandchild; killing only the CLI wrapper (`child.kill`) orphans that
    // grandchild, which then runs unbounded and burns subscription quota.
    detached: true,
    // stdin = 'ignore' (/dev/null), NOT a pipe. Under launchd (no controlling
    // TTY), a piped stdin is a socketpair whose write-end the codex node-wrapper
    // keeps open even after we close ours, so the vendored rust binary never
    // sees EOF and blocks forever on read() at ~0% CPU (observed: fd0 =
    // `unix ->(none)`). /dev/null returns EOF immediately, so the agent never
    // stalls waiting on input it is never given.
    stdio: ['ignore', 'pipe', 'pipe']
  })

/**
 * Kill the spawned agent AND its descendants. The agent runs in its own process
 * group (see `defaultSpawn` `detached`), so we signal the negative pid to reach
 * the whole group (the CLI wrapper + its vendor engine grandchild). Falls back
 * to a direct `child.kill` when there is no pid (e.g. test fakes) or the group
 * is already gone. Never throws — the child may have already exited.
 */
export const killProcessTree = (child: AgentChildProcess): void => {
  const { pid } = child
  if (typeof pid === 'number') {
    try {
      process.kill(-pid, 'SIGKILL')
      return
    } catch {
      // Group already reaped, or the child was not a group leader — fall back.
    }
  }
  try {
    child.kill('SIGKILL')
  } catch {
    // Already exited.
  }
}
