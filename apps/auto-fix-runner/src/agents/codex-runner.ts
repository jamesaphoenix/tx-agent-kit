import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Either, Schema } from 'effect'
import { autoFixResultSchema, type AutoFixResult } from '@tx-agent-kit/contracts'
import { inspectCodexAuth, type CodexAuthInspectionEnv } from './auth.js'
import { defaultSpawn, killProcessTree, type SpawnFn } from './spawn.js'
import type { AgentRunInput, AgentRunResult, AgentRunner } from './types.js'

const decodeResult = Schema.decodeUnknownEither(autoFixResultSchema)

/**
 * Cap on the codex stderr we retain. We keep only the LAST slice so a chatty
 * RUST_LOG stream cannot grow the buffer unbounded over a multi-minute run while
 * still preserving the most recent diagnostic context (where it stalled).
 */
const STDERR_TAIL_CAP_BYTES = 16 * 1024

/**
 * Build the `codex exec` argv. Kept as a pure function so unit tests can assert
 * the flag construction (--yolo / --cd / --output-schema / --ephemeral) without
 * spawning anything.
 */
export const buildCodexArgs = (input: {
  worktreePath: string
  model?: string
  schemaPath: string
  outputPath: string
  prompt: string
}): ReadonlyArray<string> => [
  'exec',
  '--yolo',
  '--cd',
  input.worktreePath,
  // Disable MCP servers for the headless fix run. The target worktree ships a
  // project `.codex/config.toml` + `.mcp.json` that register local-only stdio MCP
  // servers (prometheus/jaeger/spotlight/supabase/context7 via ./scripts/mcp/*.sh).
  // On a host without those dev services running, codex blocks on MCP startup and
  // hangs at 0% CPU forever. The agent does not need MCP to edit code, so clear
  // the table outright.
  '-c',
  'mcp_servers={}',
  // Pin a model only when one is explicitly configured; otherwise let the Codex
  // CLI pick its own default/recommended model so the runner tracks the account's
  // recommended model over time instead of a hardcoded (and possibly unsupported)
  // slug.
  ...(input.model ? ['-m', input.model] : []),
  '--json',
  '-o',
  input.outputPath,
  '--output-schema',
  input.schemaPath,
  '--ephemeral',
  // Pass the prompt as the positional PROMPT arg, NOT via stdin (`-`). Under
  // launchd (no controlling TTY) + a detached spawn, the codex node-wrapper does
  // not forward the piped stdin / its EOF to the vendored rust binary, so
  // `codex exec -` blocks forever at ~0% CPU waiting to read the prompt. Passing
  // the prompt positionally sidesteps stdin entirely.
  input.prompt
]

/**
 * Run the headless Codex CLI for one auto-fix attempt.
 *
 * Writes the JSON-Schema contract to a temp file, spawns
 * `codex exec --yolo --cd <wt> -m <model> --json -o <f> --output-schema <s>
 * --ephemeral <prompt>`, streams the NDJSON `--json` event stream (captured
 * verbatim as `jsonl` + parsed into `items` for telemetry), enforces a hard
 * abort timeout, then reads + decodes the `-o` final-message file against the
 * shared AutoFixResult schema. Codex validates natively via `--output-schema`;
 * we re-validate for defence in depth.
 */
export const runCodexExec = (
  input: AgentRunInput,
  spawnFn: SpawnFn = defaultSpawn
): Promise<AgentRunResult> => {
  const workDir = mkdtempSync(join(tmpdir(), 'auto-fix-codex-'))
  const schemaPath = join(workDir, 'schema.json')
  const outputPath = join(workDir, 'output.json')
  writeFileSync(schemaPath, JSON.stringify(input.outputSchema), 'utf8')

  const args = buildCodexArgs({
    worktreePath: input.worktreePath,
    model: input.model,
    schemaPath,
    outputPath,
    prompt: input.prompt
  })

  return new Promise<AgentRunResult>((resolve) => {
    // Enable codex's own diagnostic logging on stderr (RUST_LOG/RUST_BACKTRACE)
    // so a hang at ~0% CPU reveals WHERE it stalled. Codex-specific: merged into
    // the spawn env here rather than in the shared buildAgentEnv.
    const child = spawnFn('codex', args, {
      env: { ...input.env, RUST_LOG: 'info', RUST_BACKTRACE: '1' }
    })

    let jsonl = ''
    let stderr = ''
    const items: unknown[] = []
    let settled = false

    const timer = setTimeout(() => {
      // Kill the whole process group (the codex wrapper + its vendor engine
      // grandchild) — a bare child.kill leaves the engine orphaned and running.
      killProcessTree(child)
    }, input.timeoutMs)

    const finish = (exitCode: number | null, error?: string): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)

      let structured: AutoFixResult | null = null
      try {
        const raw = readFileSync(outputPath, 'utf8')
        const decoded = decodeResult(JSON.parse(raw))
        if (Either.isRight(decoded)) {
          structured = decoded.right
        }
      } catch {
        // No / unparseable output file — leave structured null; status is
        // derived by the activity from exitCode + structured presence.
      }

      rmSync(workDir, { recursive: true, force: true })
      resolve({
        agent: 'codex',
        structured,
        jsonl,
        items,
        exitCode,
        ...(error ? { error } : {}),
        ...(stderr.length > 0 ? { stderrTail: stderr } : {})
      })
    }

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
      // Keep only the last cap-worth of bytes so a long run cannot grow the
      // buffer unbounded; the tail holds the most recent (most useful) context.
      if (stderr.length > STDERR_TAIL_CAP_BYTES) {
        stderr = stderr.slice(stderr.length - STDERR_TAIL_CAP_BYTES)
      }
    })

    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      jsonl += text
      for (const line of text.split('\n')) {
        const trimmed = line.trim()
        if (trimmed.length === 0) {
          continue
        }
        try {
          items.push(JSON.parse(trimmed))
        } catch {
          // Partial line across chunk boundaries — kept in jsonl, skipped here.
        }
      }
    })

    child.on('error', (err: Error) => {
      finish(null, err.message)
    })
    child.on('close', (code: number | null) => {
      finish(code)
    })

    // No stdin handling: the agent is spawned with stdin = /dev/null (see
    // defaultSpawn) and the prompt is the positional PROMPT arg (buildCodexArgs),
    // so there is no `child.stdin` to write to or close.
  })
}

/**
 * Codex AgentRunner: OAuth-only auth check + headless `codex exec`. The auth
 * inspection env (codexHome + API-key presence) is captured by the caller from
 * the dedicated env module and closed over here.
 */
export const createCodexRunner = (
  authEnv: CodexAuthInspectionEnv,
  spawnFn: SpawnFn = defaultSpawn
): AgentRunner => ({
  kind: 'codex',
  inspectAuth: () => inspectCodexAuth(authEnv),
  run: (input) => runCodexExec(input, spawnFn)
})
