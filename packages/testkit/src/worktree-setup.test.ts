import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const derivePortsScriptPath = resolve(repoRoot, 'scripts/worktree/derive-ports.sh')

interface DerivedPorts {
  readonly WORKTREE_NAME: string
  readonly WORKTREE_PORT_OFFSET: string
  readonly WEB_PORT: string
  readonly API_PORT: string
  readonly MOBILE_PORT: string
  readonly WORKER_INSPECT_PORT: string
  readonly GRAFANA_PORT: string
  readonly PROMETHEUS_PORT: string
}

const parseDerivedPortsOutput = (output: string): DerivedPorts => {
  const values: Record<string, string> = {}

  for (const rawLine of output.split('\n')) {
    const line = rawLine.trim()
    if (line.length === 0) {
      continue
    }

    const separatorIndex = line.indexOf('=')
    if (separatorIndex <= 0) {
      continue
    }

    values[line.slice(0, separatorIndex)] = line.slice(separatorIndex + 1)
  }

  const requiredKeys: Array<keyof DerivedPorts> = [
    'WORKTREE_NAME',
    'WORKTREE_PORT_OFFSET',
    'WEB_PORT',
    'API_PORT',
    'MOBILE_PORT',
    'WORKER_INSPECT_PORT',
    'GRAFANA_PORT',
    'PROMETHEUS_PORT'
  ]

  const requireDerivedValue = (key: keyof DerivedPorts): string => {
    const value = values[key]
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`Missing derived port output key: ${key}`)
    }
    return value
  }

  for (const key of requiredKeys) {
    void requireDerivedValue(key)
  }

  return {
    WORKTREE_NAME: requireDerivedValue('WORKTREE_NAME'),
    WORKTREE_PORT_OFFSET: requireDerivedValue('WORKTREE_PORT_OFFSET'),
    WEB_PORT: requireDerivedValue('WEB_PORT'),
    API_PORT: requireDerivedValue('API_PORT'),
    MOBILE_PORT: requireDerivedValue('MOBILE_PORT'),
    WORKER_INSPECT_PORT: requireDerivedValue('WORKER_INSPECT_PORT'),
    GRAFANA_PORT: requireDerivedValue('GRAFANA_PORT'),
    PROMETHEUS_PORT: requireDerivedValue('PROMETHEUS_PORT')
  }
}

const derivePorts = (worktreeName: string): DerivedPorts => {
  const output = execFileSync('bash', [derivePortsScriptPath, worktreeName], {
    cwd: repoRoot,
    stdio: 'pipe',
    encoding: 'utf8'
  })

  return parseDerivedPortsOutput(output)
}

const runPortsLibCommand = (script: string): string =>
  execFileSync('bash', ['-lc', script], {
    cwd: repoRoot,
    stdio: 'pipe',
    encoding: 'utf8'
  }).trim()

const calculateOffset = (worktreeName: string): number => {
  const value = runPortsLibCommand(
    `source scripts/worktree/lib/ports.sh; calculate_port_offset ${worktreeName}`
  )
  return Number.parseInt(value, 10)
}

const resolveOffsetWithActiveWorktrees = (
  worktreeName: string,
  activeWorktreeNames: ReadonlyArray<string>
): number => {
  const args = [worktreeName, ...activeWorktreeNames].join(' ')
  const value = runPortsLibCommand(
    `source scripts/worktree/lib/ports.sh; resolve_port_offset_with_active_worktrees ${args}`
  )
  return Number.parseInt(value, 10)
}

describe('worktree port derivation', () => {
  it('returns deterministic values for the same worktree', () => {
    const first = derivePorts('wt_ports_alpha')
    const second = derivePorts('wt_ports_alpha')
    expect(second).toEqual(first)
  })

  it('derives unique API/web/mobile/worker-inspect ports across worktrees', () => {
    const first = derivePorts('wt_ports_alpha')
    const second = derivePorts('wt_ports_bravo')

    expect(first.API_PORT).not.toBe(second.API_PORT)
    expect(first.WEB_PORT).not.toBe(second.WEB_PORT)
    expect(first.MOBILE_PORT).not.toBe(second.MOBILE_PORT)
    expect(first.WORKER_INSPECT_PORT).not.toBe(second.WORKER_INSPECT_PORT)
  })

  it('keeps derived ports and offsets inside expected ranges', () => {
    const derived = derivePorts('wt_ports_alpha')

    const offset = Number.parseInt(derived.WORKTREE_PORT_OFFSET, 10)
    expect(offset).toBeGreaterThanOrEqual(100)
    expect(offset).toBeLessThanOrEqual(1099)

    const apiPort = Number.parseInt(derived.API_PORT, 10)
    const webPort = Number.parseInt(derived.WEB_PORT, 10)
    const mobilePort = Number.parseInt(derived.MOBILE_PORT, 10)
    const workerInspectPort = Number.parseInt(derived.WORKER_INSPECT_PORT, 10)

    expect(apiPort).toBe(4000 + offset)
    expect(webPort).toBe(3000 + offset)
    expect(mobilePort).toBe(8081 + offset)
    expect(workerInspectPort).toBe(9229 + offset)
  })

  it('avoids active-worktree offset collisions while staying deterministic', () => {
    const firstName = 'wt_collision_6'
    const secondName = 'wt_collision_27'

    const firstOffset = calculateOffset(firstName)
    const secondOffset = calculateOffset(secondName)
    expect(firstOffset).toBe(secondOffset)

    const secondResolved = resolveOffsetWithActiveWorktrees(secondName, [firstName])
    expect(secondResolved).not.toBe(firstOffset)

    const secondResolvedAgain = resolveOffsetWithActiveWorktrees(secondName, [firstName])
    expect(secondResolvedAgain).toBe(secondResolved)
  })

  it('avoids second-order collisions when active worktrees already collided', () => {
    const firstName = 'wt_collision_6' // base 418
    const secondName = 'wt_collision_27' // base 418 -> resolves to 419
    const thirdName = 'wt_find_170' // base 419

    expect(calculateOffset(firstName)).toBe(418)
    expect(calculateOffset(secondName)).toBe(418)
    expect(calculateOffset(thirdName)).toBe(419)

    const secondResolved = resolveOffsetWithActiveWorktrees(secondName, [firstName])
    expect(secondResolved).toBe(419)

    const thirdResolved = resolveOffsetWithActiveWorktrees(thirdName, [
      firstName,
      secondName
    ])
    expect(thirdResolved).not.toBe(secondResolved)
    expect(thirdResolved).toBe(420)
  })
})
