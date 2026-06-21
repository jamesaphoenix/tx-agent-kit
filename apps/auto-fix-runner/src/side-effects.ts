import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AutoFixEnvironment } from '@tx-agent-kit/contracts'
import { createLogger } from '@tx-agent-kit/logging'

const logger = createLogger('auto-fix-runner-side-effects')

/**
 * The worktree path `scripts/worktree/create.sh` produces, computed (NOT scraped
 * from create.sh stdout, whose last line is a human-facing "Next steps" hint).
 * create.sh derives the directory name from the branch segment after the last
 * `/` and places it under `<primaryRoot>/.worktrees/<name>`; the host worker
 * checkout is the primary root, so `repoRoot` is `<primaryRoot>`. Exported so
 * the derivation is unit-tested independent of the shelling-out.
 */
export const deriveWorktreePath = (repoRoot: string, branch: string): string =>
  join(repoRoot, '.worktrees', branch.slice(branch.lastIndexOf('/') + 1))

/**
 * Host side-effects the auto-fix activity performs around the agent run:
 * worktree creation, secret rendering, git push, draft PR, and the comment-back.
 * Grouped behind an interface so the activity depends on a seam and the
 * unit/integration tests can inject fakes (no real git/gh/op/HTTP calls).
 */
export interface AutoFixSideEffects {
  /** `scripts/worktree/create.sh autofix/<issue> origin/<base>` -> absolute worktree path. */
  readonly createWorktree: (branch: string, baseBranch: string) => Promise<string>
  /** Read the PRE-RENDERED deploy env file for the issue's environment -> KV map (in-memory). */
  readonly renderEnv: (environment: AutoFixEnvironment) => Promise<Record<string, string>>
  /** Stage and commit agent changes. Returns false when the worktree is clean. */
  readonly commitChanges: (input: {
    worktreePath: string
    message: string
    body: string
  }) => Promise<boolean>
  /** `git push -u origin <branch>` from inside the worktree. */
  readonly pushBranch: (worktreePath: string, branch: string) => Promise<void>
  /** `gh pr create --draft --base <base> ...` -> PR url. */
  readonly openDraftPr: (input: {
    worktreePath: string
    baseBranch: string
    title: string
    body: string
  }) => Promise<string>
  /** POST a comment with the branch/PR link back onto the source issue. */
  readonly commentOnSentryIssue: (sentryIssueId: string, body: string) => Promise<void>
}

/**
 * Async `child_process.spawn` wrapper that buffers stdout/stderr and rejects on
 * spawn error or a non-zero exit. Used instead of `spawnSync` so the Node event
 * loop stays free to service Temporal activity heartbeats during long-running
 * host commands (the activity runs with maximumAttempts:1, so a heartbeat
 * timeout would otherwise violate the no-retry contract). Mirrors the async
 * spawn pattern in `agents/spawn.ts`.
 */
const run = (
  command: string,
  args: ReadonlyArray<string>,
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}
): Promise<{ stdout: string }> =>
  new Promise<{ stdout: string }>((resolve, reject) => {
    const child = spawn(command, [...args], {
      ...(options.cwd ? { cwd: options.cwd } : {}),
      ...(options.env ? { env: options.env } : {}),
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''
    let settled = false

    const fail = (error: Error): void => {
      if (settled) {
        return
      }
      settled = true
      reject(error)
    }

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })

    child.on('error', (err: Error) => {
      fail(err)
    })
    child.on('close', (code: number | null) => {
      if (settled) {
        return
      }
      if (code !== 0) {
        fail(new Error(`${command} ${args.join(' ')} exited with ${code ?? 'null'}: ${stderr}`))
        return
      }
      settled = true
      resolve({ stdout })
    })
  })

/**
 * Strip ONE layer of matching outer single/double quotes from an op-inject
 * value. op renders quoted env values verbatim (e.g. `KEY="value"` /
 * `KEY='value'`); without stripping, the wrapping quotes leak into the rendered
 * secret. Mismatched or absent quotes are returned unchanged.
 */
export const stripOuterQuotes = (value: string): string => {
  if (value.length >= 2) {
    const first = value[0]
    const last = value[value.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1)
    }
  }
  return value
}

/**
 * Parse a rendered dotenv file (the pre-rendered deploy env) into a KV map.
 * Blank lines and `#` comments are skipped, the first `=` splits key from value,
 * and one layer of matching outer quotes is stripped from each value. Exported
 * so the quote-stripping contract can be unit-tested.
 */
export const parseRenderedEnv = (stdout: string): Record<string, string> => {
  const rendered: Record<string, string> = {}
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.startsWith('#')) {
      continue
    }
    const eq = trimmed.indexOf('=')
    if (eq <= 0) {
      continue
    }
    rendered[trimmed.slice(0, eq)] = stripOuterQuotes(trimmed.slice(eq + 1))
  }
  return rendered
}

/** Config for the host side-effects: where the pre-rendered env files live and
 * the Sentry token (both resolved into the worker env, never via host `op`). */
export interface HostSideEffectsConfig {
  /** Directory holding `staging.env` / `prod.env` (pre-rendered deploy env). */
  readonly resolvedEnvDir: string
  /** Sentry API token for issue comments; undefined => comment is a no-op. */
  readonly sentryAuthToken: string | undefined
  /** Sentry organization slug for the org-scoped issue comments endpoint; empty => no-op. */
  readonly sentryOrgSlug: string
  /**
   * Host env for spawning `scripts/worktree/create.sh` with a LOCAL
   * `DATABASE_URL` (the worktree setup script rejects remote DB urls). Built by
   * `buildWorktreeToolingEnv` in the env module.
   */
  readonly worktreeToolingEnv: NodeJS.ProcessEnv
}

/**
 * Default production side-effects. These shell out to the real host tooling
 * (the worktree script, git, gh) and the comment-back HTTP API. They run only on
 * the single host worker; tests inject a fake implementation instead. Secrets
 * come from PRE-RENDERED env files + the worker env (never host `op`, which is
 * unreliable non-interactively on a headless host).
 */
export const createHostSideEffects = (
  repoRoot: string,
  config: HostSideEffectsConfig
): AutoFixSideEffects => ({
  createWorktree: async (branch, baseBranch) => {
    // The host worker checkout may have NO local `<baseBranch>` ref, only the
    // remote-tracking `origin/<baseBranch>`. Fetch it fresh and branch the
    // worktree off `origin/<baseBranch>`: create.sh's `git worktree add -b`
    // needs a resolvable start-point, and a bare branch name does not DWIM to
    // the remote once `-b` is given (=> "not a valid object name").
    //
    // Spawn create.sh with DATABASE_URL forced LOCAL: the worker process carries
    // the real DATABASE_URL (to update auto_fix_runs), but the worktree setup
    // script rejects any non-local DB url. `git fetch` is happy with the same
    // env (it ignores DATABASE_URL and keeps PATH/SSH/credentials intact).
    const { worktreeToolingEnv } = config
    await run('git', ['fetch', 'origin', baseBranch], { cwd: repoRoot, env: worktreeToolingEnv })
    await run('scripts/worktree/create.sh', [branch, `origin/${baseBranch}`], {
      cwd: repoRoot,
      env: worktreeToolingEnv
    })
    // Compute the path create.sh produced rather than scraping its stdout (whose
    // last line is a "Next steps" hint, not the path), a wrong path would make
    // every later spawn (`cwd`) fail with ENOENT.
    return deriveWorktreePath(repoRoot, branch)
  },
  renderEnv: async (environment) => {
    // Read the PRE-RENDERED deploy env (the same cache deploys use) instead of
    // running `op inject` on the host, because `op` hangs non-interactively on a
    // headless host. The file already has every secret resolved to a plain value.
    const fileName = environment === 'production' ? 'prod.env' : 'staging.env'
    const contents = await readFile(`${config.resolvedEnvDir}/${fileName}`, 'utf8')
    return parseRenderedEnv(contents)
  },
  commitChanges: async ({ worktreePath, message, body }) => {
    const status = await run('git', ['status', '--porcelain'], { cwd: worktreePath })
    if (status.stdout.trim().length === 0) {
      return false
    }

    await run('git', ['add', '-A'], { cwd: worktreePath })
    const stagedFiles = await run('git', ['diff', '--cached', '--name-only'], {
      cwd: worktreePath
    })
    if (stagedFiles.stdout.trim().length === 0) {
      return false
    }

    await run('git', ['commit', '-m', message, '-m', body], { cwd: worktreePath })
    return true
  },
  pushBranch: async (worktreePath, branch) => {
    await run('git', ['push', '-u', 'origin', branch], { cwd: worktreePath })
  },
  openDraftPr: async ({ worktreePath, baseBranch, title, body }) => {
    const { stdout } = await run(
      'gh',
      ['pr', 'create', '--draft', '--base', baseBranch, '--title', title, '--body', body],
      { cwd: worktreePath }
    )
    return stdout.trim()
  },
  commentOnSentryIssue: async (sentryIssueId, body) => {
    // Token + org slug come from the worker env (resolved at install, never host
    // `op`). A missing token OR slug is non-fatal: log a warning and resolve so a
    // comment-back-side problem never fails the bug-fix run. With no slug
    // configured the comment-back is disabled entirely.
    const token = config.sentryAuthToken ?? null
    const orgSlug = config.sentryOrgSlug.trim()
    if (token === null || orgSlug.length === 0) {
      logger.warn('Comment-back token/org unavailable; skipping issue comment', { sentryIssueId })
      return
    }

    // The unscoped /api/0/issues/<id>/ endpoints 404; comments must go through
    // the organization-scoped path.
    const response = await fetch(
      `https://sentry.io/api/0/organizations/${encodeURIComponent(orgSlug)}/issues/${encodeURIComponent(sentryIssueId)}/comments/`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ text: body })
      }
    )
    if (!response.ok) {
      throw new Error(`Comment-back POST failed with status ${response.status}`)
    }
  }
})
