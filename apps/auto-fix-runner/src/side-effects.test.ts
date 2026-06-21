import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  createHostSideEffects,
  deriveWorktreePath,
  parseRenderedEnv,
  stripOuterQuotes
} from './side-effects.js'

const execFileAsync = promisify(execFile)

const git = (cwd: string, args: ReadonlyArray<string>) =>
  execFileAsync('git', [...args], { cwd })

describe('deriveWorktreePath', () => {
  it('places the worktree under <repoRoot>/.worktrees/<branch-after-last-slash>', () => {
    expect(deriveWorktreePath('/Users/x/repo-autofix', 'autofix/e2e-fullchain-123')).toBe(
      '/Users/x/repo-autofix/.worktrees/e2e-fullchain-123'
    )
  })

  it('uses the whole branch when there is no slash', () => {
    expect(deriveWorktreePath('/repo', 'hotfix')).toBe('/repo/.worktrees/hotfix')
  })

  it('keeps only the final segment for nested branch names', () => {
    expect(deriveWorktreePath('/repo', 'autofix/team/issue-9')).toBe('/repo/.worktrees/issue-9')
  })
})

describe('stripOuterQuotes', () => {
  it('strips one layer of matching double quotes', () => {
    expect(stripOuterQuotes('"postgres://user:pw@host/db"')).toBe('postgres://user:pw@host/db')
  })

  it('strips one layer of matching single quotes', () => {
    expect(stripOuterQuotes("'secret-value'")).toBe('secret-value')
  })

  it('strips only one layer when nested quotes are present', () => {
    expect(stripOuterQuotes('""double""')).toBe('"double"')
  })

  it('leaves unquoted values unchanged', () => {
    expect(stripOuterQuotes('plain-value')).toBe('plain-value')
  })

  it('leaves mismatched quotes unchanged', () => {
    expect(stripOuterQuotes('"mismatch\'')).toBe('"mismatch\'')
    expect(stripOuterQuotes('"only-leading')).toBe('"only-leading')
  })

  it('leaves a lone quote unchanged', () => {
    expect(stripOuterQuotes('"')).toBe('"')
  })
})

describe('parseRenderedEnv', () => {
  it('strips wrapping quotes from rendered values', () => {
    const rendered = parseRenderedEnv(
      [
        '# comment',
        '',
        'DATABASE_URL="postgres://user:pw@host/db"',
        "API_KEY='sk-live-123'",
        'PLAIN=value',
        'NUMERIC=42'
      ].join('\n')
    )

    expect(rendered).toEqual({
      DATABASE_URL: 'postgres://user:pw@host/db',
      API_KEY: 'sk-live-123',
      PLAIN: 'value',
      NUMERIC: '42'
    })
  })

  it('skips comments, blank lines, and lines without a key', () => {
    const rendered = parseRenderedEnv(['# header', '   ', '=novalue', 'KEY=val'].join('\n'))
    expect(rendered).toEqual({ KEY: 'val' })
  })

  it('keeps inner = characters in the value', () => {
    const rendered = parseRenderedEnv('TOKEN="a=b=c"')
    expect(rendered).toEqual({ TOKEN: 'a=b=c' })
  })
})

describe('createHostSideEffects.renderEnv (pre-rendered file)', () => {
  let dir: string

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'autofix-resolved-env-'))
    await writeFile(join(dir, 'staging.env'), 'DATABASE_URL="postgres://staging"\nKEY=stg\n')
    await writeFile(join(dir, 'prod.env'), 'DATABASE_URL="postgres://prod"\nKEY=prd\n')
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const fx = () =>
    createHostSideEffects('/repo', {
      resolvedEnvDir: dir,
      sentryAuthToken: undefined,
      sentryOrgSlug: 'test-org',
      worktreeToolingEnv: {}
    })

  it('reads staging.env (and strips quotes) for a staging environment', async () => {
    await expect(fx().renderEnv('staging')).resolves.toEqual({
      DATABASE_URL: 'postgres://staging',
      KEY: 'stg'
    })
  })

  it('reads prod.env for a production environment', async () => {
    await expect(fx().renderEnv('production')).resolves.toEqual({
      DATABASE_URL: 'postgres://prod',
      KEY: 'prd'
    })
  })
})

describe('createHostSideEffects.commitChanges', () => {
  let repo: string
  let envDir: string

  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), 'autofix-commit-repo-'))
    envDir = await mkdtemp(join(tmpdir(), 'autofix-commit-env-'))
    await writeFile(join(envDir, 'staging.env'), 'KEY=value\n')

    await git(repo, ['init'])
    await git(repo, ['config', 'user.email', 'autofix@example.com'])
    await git(repo, ['config', 'user.name', 'Auto Fix'])
    await writeFile(join(repo, 'file.txt'), 'before\n')
    await git(repo, ['add', 'file.txt'])
    await git(repo, ['commit', '-m', 'initial'])
  })

  afterAll(async () => {
    await rm(repo, { recursive: true, force: true })
    await rm(envDir, { recursive: true, force: true })
  })

  const fx = () =>
    createHostSideEffects(repo, {
      resolvedEnvDir: envDir,
      sentryAuthToken: undefined,
      sentryOrgSlug: 'test-org',
      worktreeToolingEnv: {}
    })

  it('stages and commits dirty worktree changes', async () => {
    await writeFile(join(repo, 'file.txt'), 'after\n')

    await expect(
      fx().commitChanges({
        worktreePath: repo,
        message: 'fix: update file',
        body: 'Generated by auto-fix for ISSUE-1.'
      })
    ).resolves.toBe(true)

    const status = await git(repo, ['status', '--porcelain'])
    expect(status.stdout).toBe('')
    const log = await git(repo, ['log', '-1', '--pretty=%s%n%b'])
    expect(log.stdout).toContain('fix: update file')
    expect(log.stdout).toContain('Generated by auto-fix for ISSUE-1.')
  })

  it('returns false for a clean worktree', async () => {
    await expect(
      fx().commitChanges({
        worktreePath: repo,
        message: 'fix: no-op',
        body: 'No changes expected.'
      })
    ).resolves.toBe(false)
  })
})

describe('createHostSideEffects.commentOnSentryIssue', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const fx = (token: string | undefined, orgSlug = 'test-org') =>
    createHostSideEffects('/repo', {
      resolvedEnvDir: '/nowhere',
      sentryAuthToken: token,
      sentryOrgSlug: orgSlug,
      worktreeToolingEnv: {}
    })

  it('POSTs to the organization-scoped comments endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201 })
    vi.stubGlobal('fetch', fetchMock)

    await fx('sentry-token').commentOnSentryIssue('127287182', 'Auto-fix done')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://sentry.io/api/0/organizations/test-org/issues/127287182/comments/',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('is a no-op without a token', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await fx(undefined).commentOnSentryIssue('127287182', 'Auto-fix done')

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('is a no-op without an org slug', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await fx('sentry-token', '').commentOnSentryIssue('127287182', 'Auto-fix done')

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))

    await expect(fx('sentry-token').commentOnSentryIssue('127287182', 'comment body')).rejects.toThrow(
      'Comment-back POST failed with status 404'
    )
  })
})
