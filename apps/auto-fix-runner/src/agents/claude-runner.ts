import { Either, Schema } from 'effect'
import { autoFixResultSchema, type AutoFixResult } from '@tx-agent-kit/contracts'
import { validateClaudeAuth } from './auth.js'
import { defaultSpawn, killProcessTree, type SpawnFn } from './spawn.js'
import type { AgentRunInput, AgentRunResult, AgentRunner } from './types.js'

const decodeResult = Schema.decodeUnknownEither(autoFixResultSchema)

/**
 * Build the `claude -p` argv. Pure so unit tests can assert the
 * `-p <prompt>` / `--output-format json` / `--model` flag construction without
 * spawning. `claude -p` takes the prompt as a positional argument immediately
 * after `-p`, so we pass it there rather than on stdin.
 * `--dangerously-skip-permissions` puts the CLI in full-auto on the isolated
 * host (mirrors codex `--yolo`).
 */
export const buildClaudeArgs = (
  model: string | undefined,
  prompt: string
): ReadonlyArray<string> => [
  '-p',
  prompt,
  '--output-format',
  'json',
  '--dangerously-skip-permissions',
  // Pin a model only when explicitly configured; otherwise let the Claude CLI
  // pick its own default/recommended model.
  ...(model ? ['--model', model] : [])
]

/**
 * Extract the agent's structured result from the Claude CLI JSON envelope.
 *
 * `claude -p --output-format json` emits a single JSON object with a `result`
 * field (the assistant's final message). The agent is prompted to make that
 * message a JSON object matching AutoFixResult, so we accept either an already
 * object-shaped `result` or a JSON string we parse, then validate against the
 * shared effect/Schema. Returns null on any parse/validation failure.
 */
export const extractClaudeResult = (envelopeJson: string): AutoFixResult | null => {
  let envelope: unknown
  try {
    envelope = JSON.parse(envelopeJson)
  } catch {
    return null
  }
  if (typeof envelope !== 'object' || envelope === null) {
    return null
  }
  const result = (envelope as { result?: unknown }).result
  let candidate: unknown = result
  if (typeof result === 'string') {
    try {
      candidate = JSON.parse(result)
    } catch {
      return null
    }
  }
  const decoded = decodeResult(candidate)
  return Either.isRight(decoded) ? decoded.right : null
}

/**
 * Run the headless Claude CLI for one auto-fix attempt.
 *
 * Spawns `claude -p <prompt> --output-format json --dangerously-skip-permissions
 * --model <model>` with cwd = the prepared worktree (the prompt is the positional
 * arg after `-p`, not piped on stdin),
 * captures stdout verbatim (the raw JSON envelope, kept as `jsonl` for audit),
 * enforces a hard abort timeout, then parses + validates the envelope's result
 * against the shared AutoFixResult schema ourselves (Claude has no native
 * --output-schema equivalent).
 */
export const runClaudeExec = (
  input: AgentRunInput,
  spawnFn: SpawnFn = defaultSpawn
): Promise<AgentRunResult> =>
  new Promise<AgentRunResult>((resolve) => {
    const child = spawnFn('claude', buildClaudeArgs(input.model, input.prompt), {
      env: input.env,
      cwd: input.worktreePath
    })

    let jsonl = ''
    let stderr = ''
    let settled = false

    const timer = setTimeout(() => {
      // Kill the whole process group (the CLI wrapper + any engine grandchild) —
      // a bare child.kill can leave a detached engine orphaned and running.
      killProcessTree(child)
    }, input.timeoutMs)

    const finish = (exitCode: number | null, error?: string): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      const structured = extractClaudeResult(jsonl)
      resolve({
        agent: 'claude',
        structured,
        jsonl,
        items: [],
        exitCode,
        ...(error ? { error } : {}),
        ...(stderr.length > 0 ? { stderrTail: stderr } : {})
      })
    }

    child.stdout.on('data', (chunk: Buffer) => {
      jsonl += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', (err: Error) => {
      finish(null, err.message)
    })
    child.on('close', (code: number | null) => {
      finish(code)
    })

    // No stdin handling: the agent is spawned with stdin = /dev/null (see
    // defaultSpawn) and the prompt is the positional `-p` arg, so there is no
    // `child.stdin` to write to or close.
  })

/**
 * Claude AgentRunner: subscription-session auth check + headless `claude -p`.
 * The auth-check child env (the host snapshot with ANTHROPIC_API_KEY stripped)
 * is captured by the caller from the dedicated env module and closed over here.
 */
export const createClaudeRunner = (
  authCheckEnv: Record<string, string>,
  spawnFn: SpawnFn = defaultSpawn
): AgentRunner => ({
  kind: 'claude',
  inspectAuth: () => validateClaudeAuth(authCheckEnv),
  run: (input) => runClaudeExec(input, spawnFn)
})
