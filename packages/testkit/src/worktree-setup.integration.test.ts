import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { getTestkitEnv, getTestkitProcessEnv } from './env.js'
import {
  defaultWorktreeSetupDatabaseUrl,
  runWorktreeSetup
} from './worktree-setup.js'

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

const worktreeBatchLatencyBudgetMs = parsePositiveInt(
  process.env.WORKTREE_SETUP_BATCH_MAX_LATENCY_MS,
 15_000
)
const worktreeBatchTestTimeoutMs = Math.max(30_000, worktreeBatchLatencyBudgetMs + 10_000)

describe('worktree setup integration', () => {
  const tempRootPath = mkdtempSync(resolve(tmpdir(), 'tx-agent-kit-worktree-setup-'))
  const createdWorktreePaths: string[] = []

  afterAll(() => {
    for (const worktreePath of createdWorktreePaths) {
      const resetScriptPath = resolve(worktreePath, 'reset-worktree-schema.sh')

      try {
        execFileSync('bash', [resetScriptPath], {
          cwd: worktreePath,
          env: getTestkitProcessEnv(),
          stdio: 'pipe'
        })
      } catch (error) {
        // best-effort cleanup only
        void error
      }
    }

    rmSync(tempRootPath, {
      recursive: true,
      force: true
    })
  })

  it(
    'allocates isolated app ports and Temporal task queues for multiple worktrees',
    () => {
      const databaseUrl = getTestkitEnv().DATABASE_URL ?? defaultWorktreeSetupDatabaseUrl
      const firstWorktreeName = 'wt_ports_alpha'
      const secondWorktreeName = 'wt_ports_bravo'

      const firstSetup = runWorktreeSetup(firstWorktreeName, tempRootPath, databaseUrl)
      createdWorktreePaths.push(firstSetup.path)

      const secondSetup = runWorktreeSetup(secondWorktreeName, tempRootPath, databaseUrl)
      createdWorktreePaths.push(secondSetup.path)

      const parsePort = (value: string | undefined): number => Number.parseInt(value ?? '', 10)

      const firstApiPort = parsePort(firstSetup.envValues['API_PORT'])
      const secondApiPort = parsePort(secondSetup.envValues['API_PORT'])
      expect(Number.isFinite(firstApiPort)).toBe(true)
      expect(Number.isFinite(secondApiPort)).toBe(true)
      expect(firstApiPort).not.toBe(secondApiPort)

      const firstWebPort = parsePort(firstSetup.envValues['WEB_PORT'])
      const secondWebPort = parsePort(secondSetup.envValues['WEB_PORT'])
      expect(Number.isFinite(firstWebPort)).toBe(true)
      expect(Number.isFinite(secondWebPort)).toBe(true)
      expect(firstWebPort).not.toBe(secondWebPort)

      const firstMobilePort = parsePort(firstSetup.envValues['MOBILE_PORT'])
      const secondMobilePort = parsePort(secondSetup.envValues['MOBILE_PORT'])
      expect(Number.isFinite(firstMobilePort)).toBe(true)
      expect(Number.isFinite(secondMobilePort)).toBe(true)
      expect(firstMobilePort).not.toBe(secondMobilePort)

      const firstWorkerInspectPort = parsePort(firstSetup.envValues['WORKER_INSPECT_PORT'])
      const secondWorkerInspectPort = parsePort(secondSetup.envValues['WORKER_INSPECT_PORT'])
      expect(Number.isFinite(firstWorkerInspectPort)).toBe(true)
      expect(Number.isFinite(secondWorkerInspectPort)).toBe(true)
      expect(firstWorkerInspectPort).not.toBe(secondWorkerInspectPort)

      const firstOffset = parsePort(firstSetup.envValues['WORKTREE_PORT_OFFSET'])
      const secondOffset = parsePort(secondSetup.envValues['WORKTREE_PORT_OFFSET'])
      expect(Number.isFinite(firstOffset)).toBe(true)
      expect(Number.isFinite(secondOffset)).toBe(true)
      expect(firstOffset).toBeGreaterThanOrEqual(100)
      expect(firstOffset).toBeLessThanOrEqual(1099)
      expect(secondOffset).toBeGreaterThanOrEqual(100)
      expect(secondOffset).toBeLessThanOrEqual(1099)

      expect(firstSetup.envValues['TEMPORAL_TASK_QUEUE']).toBe(
        `tx-agent-kit-${firstWorktreeName}`
      )
      expect(secondSetup.envValues['TEMPORAL_TASK_QUEUE']).toBe(
        `tx-agent-kit-${secondWorktreeName}`
      )
      expect(firstSetup.envValues['TEMPORAL_TASK_QUEUE']).not.toBe(
        secondSetup.envValues['TEMPORAL_TASK_QUEUE']
      )

      expect(firstSetup.envValues['API_BASE_URL']).toBe(`http://localhost:${firstApiPort}`)
      expect(secondSetup.envValues['API_BASE_URL']).toBe(`http://localhost:${secondApiPort}`)
      expect(firstSetup.envValues['NEXT_PUBLIC_API_BASE_URL']).toBe(
        firstSetup.envValues['API_BASE_URL']
      )
      expect(secondSetup.envValues['NEXT_PUBLIC_API_BASE_URL']).toBe(
        secondSetup.envValues['API_BASE_URL']
      )
      expect(firstSetup.envValues['EXPO_PUBLIC_API_BASE_URL']).toBe(
        firstSetup.envValues['API_BASE_URL']
      )
      expect(secondSetup.envValues['EXPO_PUBLIC_API_BASE_URL']).toBe(
        secondSetup.envValues['API_BASE_URL']
      )

      // Observability infra is intentionally shared across worktrees.
      expect(firstSetup.envValues['OTEL_EXPORTER_OTLP_ENDPOINT']).toBe('http://localhost:4320')
      expect(secondSetup.envValues['OTEL_EXPORTER_OTLP_ENDPOINT']).toBe('http://localhost:4320')
      expect(firstSetup.envValues['NEXT_PUBLIC_OTEL_EXPORTER_OTLP_ENDPOINT']).toBe(
        'http://localhost:4320'
      )
      expect(secondSetup.envValues['NEXT_PUBLIC_OTEL_EXPORTER_OTLP_ENDPOINT']).toBe(
        'http://localhost:4320'
      )
      expect(firstSetup.envValues['EXPO_PUBLIC_OTEL_EXPORTER_OTLP_ENDPOINT']).toBe(
        'http://localhost:4320'
      )
      expect(secondSetup.envValues['EXPO_PUBLIC_OTEL_EXPORTER_OTLP_ENDPOINT']).toBe(
        'http://localhost:4320'
      )
    },
    180_000
  )

  it(
    'resolves unique offsets for large active-worktree batches within a practical latency budget',
    () => {
      const repoRoot = resolve(import.meta.dirname, '../../..')
      const worktreeNames = Array.from({ length: 64 }, (_value, index) => `wt_batch_${index + 1}`)

      const runPortResolutionBatch = (
        names: string[]
      ): { output: string; durationMs: number } => {
        const quotedNames = names.map((name) => `'${name}'`).join(' ')
        const startedAt = globalThis.performance.now()

        const output = execFileSync(
          'bash',
          [
            '-lc',
            `
              source scripts/worktree/lib/ports.sh
              active_names=()
              for worktree_name in ${quotedNames}; do
                if (( \${#active_names[@]} == 0 )); then
                  resolved_offset="$(resolve_port_offset_with_active_worktrees "$worktree_name")"
                else
                  resolved_offset="$(resolve_port_offset_with_active_worktrees "$worktree_name" "\${active_names[@]}")"
                fi
                printf '%s=%s\n' "$worktree_name" "$resolved_offset"
                active_names+=("$worktree_name")
              done
            `
          ],
          {
            cwd: repoRoot,
            stdio: 'pipe',
            encoding: 'utf8'
          }
        )

        return {
          output,
          durationMs: globalThis.performance.now() - startedAt
        }
      }

      const { output: offsetsOutput, durationMs } = runPortResolutionBatch(worktreeNames)

      const seenOffsets = new Set<number>()
      for (const rawLine of offsetsOutput.split('\n')) {
        const line = rawLine.trim()
        if (line.length === 0) {
          continue
        }

        const equalsIndex = line.indexOf('=')
        expect(equalsIndex).toBeGreaterThan(0)
        const offsetValue = line.slice(equalsIndex + 1)
        const offset = Number.parseInt(offsetValue, 10)

        expect(offset).toBeGreaterThanOrEqual(100)
        expect(offset).toBeLessThanOrEqual(1099)
        expect(seenOffsets.has(offset)).toBe(false)
        seenOffsets.add(offset)
      }

      expect(seenOffsets.size).toBe(worktreeNames.length)

      expect(Number.isFinite(durationMs)).toBe(true)
      expect(durationMs).toBeLessThan(worktreeBatchLatencyBudgetMs)
    },
    worktreeBatchTestTimeoutMs
  )
})
