import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { buildClaudeArgs, extractClaudeResult, runClaudeExec } from './claude-runner.js'
import type { AgentChildProcess, SpawnFn } from './spawn.js'
import type { AgentRunInput } from './types.js'

describe('buildClaudeArgs', () => {
  it('constructs the claude -p argv with the prompt positional, json output format and model', () => {
    const args = buildClaudeArgs('claude-sonnet-4-5', 'fix the bug')
    expect(args).toContain('-p')
    expect(args[args.indexOf('-p') + 1]).toBe('fix the bug')
    expect(args).toContain('--output-format')
    expect(args[args.indexOf('--output-format') + 1]).toBe('json')
    expect(args).toContain('--dangerously-skip-permissions')
    expect(args).toContain('--model')
    expect(args[args.indexOf('--model') + 1]).toBe('claude-sonnet-4-5')
  })

  it('omits --model when none is pinned so the Claude CLI picks its own default', () => {
    const args = buildClaudeArgs(undefined, 'fix the bug')
    expect(args).not.toContain('--model')
    expect(args).toContain('-p')
    expect(args[args.indexOf('-p') + 1]).toBe('fix the bug')
  })
})

describe('extractClaudeResult', () => {
  const validResult = {
    outcome: 'fixed',
    summary: 's',
    rootCause: 'r',
    prTitle: 't',
    prBody: 'b',
    filesChanged: ['a.ts'],
    testsRun: true,
    testsPassed: true,
    needsManualInput: false,
    blockers: []
  }

  it('parses + validates the result when it is an object', () => {
    const envelope = JSON.stringify({ result: validResult })
    expect(extractClaudeResult(envelope)?.outcome).toBe('fixed')
  })

  it('parses a JSON-string result', () => {
    const envelope = JSON.stringify({ result: JSON.stringify(validResult) })
    expect(extractClaudeResult(envelope)?.outcome).toBe('fixed')
  })

  it('returns null when the result fails schema validation', () => {
    const envelope = JSON.stringify({ result: { outcome: 'maybe' } })
    expect(extractClaudeResult(envelope)).toBeNull()
  })

  it('returns null on non-JSON output', () => {
    expect(extractClaudeResult('not json')).toBeNull()
  })
})

const makeFakeSpawn = (
  captured: {
    command?: string
    args?: ReadonlyArray<string>
    cwd?: string
    env?: Record<string, string>
    stdin?: string
  },
  stdoutPayload: string
): SpawnFn => {
  return (command, args, options) => {
    captured.command = command
    captured.args = args
    captured.cwd = options.cwd
    captured.env = options.env
    const child = new EventEmitter() as unknown as AgentChildProcess
    const stdout = new EventEmitter()
    const stderr = new EventEmitter()
    // Agent is spawned with stdin = /dev/null; the runner never touches
    // child.stdin, so drive completion off spawn (not a stdin write/end).
    setImmediate(() => {
      stdout.emit('data', Buffer.from(stdoutPayload))
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
  model: 'claude-sonnet-4-5',
  prompt: 'fix the bug',
  outputSchema: { type: 'object' },
  env: { HOME: '/Users/test', PATH: '/usr/bin' },
  timeoutMs: 1000
}

describe('runClaudeExec', () => {
  it('spawns claude -p --output-format json with cwd = worktree and validates the envelope result', async () => {
    const captured: {
      command?: string
      args?: ReadonlyArray<string>
      cwd?: string
      env?: Record<string, string>
      stdin?: string
    } = {}
    const envelope = JSON.stringify({
      result: {
        outcome: 'fixed',
        summary: 's',
        rootCause: 'r',
        prTitle: 't',
        prBody: 'b',
        filesChanged: [],
        testsRun: true,
        testsPassed: true,
        needsManualInput: false,
        blockers: []
      }
    })
    const result = await runClaudeExec(baseInput, makeFakeSpawn(captured, envelope))

    expect(captured.command).toBe('claude')
    expect(captured.args).toContain('-p')
    expect(captured.args?.[(captured.args?.indexOf('-p') ?? -1) + 1]).toBe('fix the bug')
    expect(captured.args).toContain('--output-format')
    expect(captured.cwd).toBe('/wt/autofix-123')
    expect(captured.env).toEqual(baseInput.env)
    expect(captured.stdin).toBeUndefined()

    expect(result.agent).toBe('claude')
    expect(result.exitCode).toBe(0)
    expect(result.structured?.outcome).toBe('fixed')
  })
})
