import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { buildCodexArgs, runCodexExec } from './codex-runner.js'
import type { AgentChildProcess, SpawnFn } from './spawn.js'
import type { AgentRunInput } from './types.js'

describe('buildCodexArgs', () => {
  it('constructs the codex exec argv with the required flags', () => {
    const args = buildCodexArgs({
      worktreePath: '/wt/autofix-123',
      model: 'gpt-5-codex',
      schemaPath: '/tmp/schema.json',
      outputPath: '/tmp/output.json',
      prompt: 'fix the bug'
    })
    expect(args[0]).toBe('exec')
    expect(args).toContain('--yolo')
    expect(args).toContain('--cd')
    expect(args[args.indexOf('--cd') + 1]).toBe('/wt/autofix-123')
    expect(args).toContain('-m')
    expect(args[args.indexOf('-m') + 1]).toBe('gpt-5-codex')
    expect(args).toContain('--json')
    expect(args).toContain('--output-schema')
    expect(args[args.indexOf('--output-schema') + 1]).toBe('/tmp/schema.json')
    expect(args).toContain('--ephemeral')
    // MCP disabled so codex cannot hang on the worktree's local-only MCP servers.
    expect(args).toContain('-c')
    expect(args[args.indexOf('-c') + 1]).toBe('mcp_servers={}')
    // Prompt is the positional PROMPT arg, NOT read from stdin (`-`).
    expect(args).not.toContain('-')
    expect(args[args.length - 1]).toBe('fix the bug')
  })

  it('omits -m when no model is pinned so the Codex CLI picks its own default', () => {
    const args = buildCodexArgs({
      worktreePath: '/wt/autofix-123',
      schemaPath: '/tmp/schema.json',
      outputPath: '/tmp/output.json',
      prompt: 'fix the bug'
    })
    expect(args).not.toContain('-m')
    expect(args).toContain('--json')
    expect(args[args.length - 1]).toBe('fix the bug')
  })
})

/**
 * Minimal fake child that records argv/env, then emits one NDJSON line and
 * closes on the next tick. The agent is spawned with stdin = /dev/null, so the
 * runner never touches `child.stdin`; the fake sets it to `null` to match and
 * drives completion off spawn (not a stdin write/end).
 */
const makeFakeSpawn = (
  captured: {
    command?: string
    args?: ReadonlyArray<string>
    env?: Record<string, string>
    stdin?: string
  },
  options: { stdoutLine?: string; stderrChunk?: string } = {}
): SpawnFn => {
  return (command, args, spawnOptions) => {
    captured.command = command
    captured.args = args
    captured.env = spawnOptions.env
    const child = new EventEmitter() as unknown as AgentChildProcess
    const stdout = new EventEmitter()
    const stderr = new EventEmitter()
    // Emit one NDJSON line (+ optional stderr), then close on next tick.
    setImmediate(() => {
      stdout.emit('data', Buffer.from(options.stdoutLine ?? '{"type":"item"}\n'))
      if (options.stderrChunk) {
        stderr.emit('data', Buffer.from(options.stderrChunk))
      }
      ;(child as unknown as EventEmitter).emit('close', 0)
    })
    Object.defineProperty(child, 'stdout', { value: stdout })
    Object.defineProperty(child, 'stderr', { value: stderr })
    Object.defineProperty(child, 'stdin', { value: null })
    ;(child as unknown as { kill: () => void }).kill = () => {}
    return child
  }
}

const baseInput: AgentRunInput = {
  worktreePath: '/wt/autofix-123',
  model: 'gpt-5-codex',
  prompt: 'fix the bug',
  outputSchema: { type: 'object' },
  env: { HOME: '/Users/test', PATH: '/usr/bin' },
  timeoutMs: 1000
}

/**
 * Fake child that NEVER closes on its own, so the abort timer must fire. Its
 * `kill` records the call and emulates the OS by emitting `close` (pid is
 * undefined, so killProcessTree falls back to child.kill — no real signal is
 * sent to any process group during the test).
 */
const makeHangingSpawn = (captured: { killed?: boolean }): SpawnFn => {
  return () => {
    const child = new EventEmitter() as unknown as AgentChildProcess
    const stdout = new EventEmitter()
    const stderr = new EventEmitter()
    Object.defineProperty(child, 'stdout', { value: stdout })
    Object.defineProperty(child, 'stderr', { value: stderr })
    Object.defineProperty(child, 'stdin', { value: null })
    ;(child as unknown as { kill: () => boolean }).kill = () => {
      captured.killed = true
      setImmediate(() => (child as unknown as EventEmitter).emit('close', null))
      return true
    }
    return child
  }
}

describe('runCodexExec', () => {
  it('kills the agent on timeout and resolves with no structured result', async () => {
    const captured: { killed?: boolean } = {}
    const result = await runCodexExec({ ...baseInput, timeoutMs: 20 }, makeHangingSpawn(captured))
    expect(captured.killed).toBe(true)
    expect(result.structured).toBeNull()
    expect(result.exitCode).toBeNull()
  })

  it('spawns the codex binary with the yolo/cd/output-schema flags and passes the prompt positionally (not via stdin)', async () => {
    const captured: {
      command?: string
      args?: ReadonlyArray<string>
      env?: Record<string, string>
      stdin?: string
    } = {}
    const result = await runCodexExec(baseInput, makeFakeSpawn(captured))

    expect(captured.command).toBe('codex')
    expect(captured.args?.[0]).toBe('exec')
    expect(captured.args).toContain('--yolo')
    expect(captured.args).toContain('--cd')
    expect(captured.args).toContain('--output-schema')
    // Codex-specific diagnostic logging is merged into the spawn env on top of
    // the activity-supplied env (which is left otherwise untouched).
    expect(captured.env).toMatchObject({
      ...baseInput.env,
      RUST_LOG: 'info',
      RUST_BACKTRACE: '1'
    })
    // Prompt is the positional PROMPT arg (last argv element), not piped to stdin.
    expect(captured.args?.[captured.args.length - 1]).toBe('fix the bug')
    expect(captured.stdin).toBeUndefined()

    expect(result.agent).toBe('codex')
    expect(result.exitCode).toBe(0)
    expect(result.items).toHaveLength(1)
    expect(result.jsonl).toContain('"type":"item"')
    // No valid output file written by the fake -> structured is null.
    expect(result.structured).toBeNull()
  })

  it('captures codex stderr into the result so a hung/failed run records where it stalled', async () => {
    const captured: { command?: string } = {}
    const result = await runCodexExec(
      baseInput,
      makeFakeSpawn(captured, { stderrChunk: 'TRACE codex_core: waiting on MCP startup\n' })
    )
    expect(result.stderrTail).toContain('waiting on MCP startup')
  })

  it('caps the captured stderr tail to bound memory, keeping the most recent bytes', async () => {
    const captured: { command?: string } = {}
    // 20KB of stderr — above the ~16KB cap. The runner keeps only the tail.
    const head = 'A'.repeat(20 * 1024)
    const marker = 'STALL_MARKER_AT_END'
    const result = await runCodexExec(
      baseInput,
      makeFakeSpawn(captured, { stderrChunk: head + marker })
    )
    expect(result.stderrTail).toBeDefined()
    expect((result.stderrTail ?? '').length).toBeLessThanOrEqual(16 * 1024)
    // The most recent bytes survive, the oldest are dropped.
    expect(result.stderrTail).toContain(marker)
  })
})
