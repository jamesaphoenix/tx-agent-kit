/**
 * Regression tests for `scripts/temporal/lib.sh`'s multi-worktree
 * `TEMPORAL_CLI_DB_FILENAME` resolution (iter-7 of the billing audit).
 *
 * The bug this pins:
 *   Previously `lib.sh` resolved the db-filename against `$PROJECT_ROOT`,
 *   which is `$SCRIPT_DIR/../..` — the **current worktree** root. Every
 *   worktree therefore tried to own its own `.data/temporal/dev-state.db`
 *   file but they all tried to listen on the shared port 7233 — so
 *   whichever worktree started first won and later worktrees saw a
 *   stale handle that broke `workflow.start` RPCs.
 *
 *   The fix resolves the path against the PRIMARY git checkout via
 *   `git worktree list --porcelain` (same pattern as `setup.sh` uses
 *   for `.env` seeding). All worktrees now share one server + db file
 *   + port, with per-worktree task queues providing isolation.
 *
 * Why this test matters:
 *   Infrastructure scripts have no type system and very little test
 *   coverage. A revert to `$PROJECT_ROOT` would be invisible to
 *   TypeScript / ESLint / the existing integration suites but would
 *   silently re-break multi-worktree temporal dev servers for every
 *   developer running tests in parallel worktrees. This test spawns
 *   bash, sources lib.sh, and asserts the resolved path is NOT under
 *   the calling script's worktree directory.
 */
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(import.meta.dirname, '../../..')
const temporalLibPath = resolve(repoRoot, 'scripts/temporal/lib.sh')

/**
 * Source `scripts/temporal/lib.sh` in a bash subprocess and echo the
 * resolved `TEMPORAL_CLI_DB_FILENAME`. Returns the trimmed stdout or
 * throws if bash exits non-zero. Any environment override is passed
 * through so tests can verify the `TEMPORAL_CLI_DB_FILENAME=...`
 * explicit-override path still works.
 */
const resolveDbFilename = (env: Readonly<NodeJS.ProcessEnv> = {}): string => {
  const result = spawnSync(
    'bash',
    ['-c', `set -o pipefail; source "${temporalLibPath}" && printf '%s' "$TEMPORAL_CLI_DB_FILENAME"`],
    {
      cwd: repoRoot,
      env: { ...process.env, ...env },
      encoding: 'utf8',
      timeout: 10_000
    }
  )
  if (result.status !== 0) {
    throw new Error(
      `Sourcing temporal lib.sh failed (exit ${result.status}):\nstdout=${result.stdout}\nstderr=${result.stderr}`
    )
  }
  return result.stdout.trim()
}

describe('scripts/temporal/lib.sh — TEMPORAL_CLI_DB_FILENAME resolution', () => {
  it('resolves the db-filename outside the current worktree directory (primary checkout rooted)', () => {
    // The repo might BE the primary checkout, or it might be a worktree.
    // Either way, the resolved path must end in `.data/temporal/dev-state.db`.
    const resolved = resolveDbFilename({ TEMPORAL_CLI_DB_FILENAME: '' })
    expect(resolved.endsWith('/.data/temporal/dev-state.db')).toBe(true)
    // The resolved path must NOT contain `/.claude/worktrees/` —
    // that's the worktree-local path pattern that the iter-7 fix moved
    // AWAY from. A revert to `$PROJECT_ROOT/.data/...` would produce a
    // path containing `/.claude/worktrees/` when this test runs from
    // inside a worktree. This assertion is the primary regression
    // guard for the iter-7 fix.
    expect(resolved).not.toContain('/.claude/worktrees/')
  })

  it('honors an explicit TEMPORAL_CLI_DB_FILENAME override from env', () => {
    const override = '/tmp/tx-agent-kit-test-temporal-override.db'
    const resolved = resolveDbFilename({ TEMPORAL_CLI_DB_FILENAME: override })
    expect(resolved).toBe(override)
  })

  it('exposes the other temporal CLI variables with their defaults', () => {
    // Spot-check that sourcing lib.sh populates neighbouring vars so a
    // regression in the sourcing structure (e.g. early exit) would fire
    // this test too, not just the db-filename guard above.
    const result = spawnSync(
      'bash',
      [
        '-c',
        `set -o pipefail; source "${temporalLibPath}" && printf '%s|%s|%s' "$TEMPORAL_CLI_PORT" "$TEMPORAL_CLI_UI_PORT" "$TEMPORAL_CLI_METRICS_PORT"`
      ],
      {
        cwd: repoRoot,
        env: process.env,
        encoding: 'utf8',
        timeout: 10_000
      }
    )
    if (result.status !== 0) {
      throw new Error(`bash exit ${result.status}: ${result.stderr}`)
    }
    const [port, uiPort, metricsPort] = result.stdout.split('|')
    expect(port).toBe('7233')
    expect(uiPort).toBe('8233')
    expect(metricsPort).toBe('9091')
  })
})
