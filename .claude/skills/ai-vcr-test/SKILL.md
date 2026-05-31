---
name: ai-vcr-test
description: Build and use the VCR (Video Cassette Recorder) test caching system for AI integration tests. Use when adding new AI tests, converting existing RUN_LIVE_INTEGRATION tests to cached replay, or managing cassette recordings.
argument-hint: <suite-name>
---

# AI VCR Test Caching

Cache expensive AI/LLM calls as deterministic cassettes so integration tests run fast, offline, and free in CI while still hitting real APIs during recording.

## Architecture

The VCR system has two layers:

1. **Custom VCR** (`packages/testkit/src/vcr/`) — Operation-level caching. Cache key is `sha256(operationType + model + input + tools)`. Works for any expensive async operation: LLM completions, image generation, video renders, evals, embeddings. This is NOT HTTP-level interception — it wraps the operation function directly.
2. **MSW** (Mock Service Worker) — HTTP-level interception for precision testing: error scenarios (429, 500), rate limits, malformed responses, streaming edge cases, partial failures. Also powers `withOpenRouterVcr()` for HTTP-level recording when you need to capture raw request/response pairs.

### VCR Modes

Controlled by the `VCR_MODE` environment variable:

| Mode | Behavior | Default for |
|------|----------|-------------|
| `replay` | Read cassette, **fail if missing** | CI |
| `record` | Always hit real API, overwrite cassette | Re-recording |
| `record-missing` | Replay if cassette exists, record if not | Local dev |
| `passthrough` | No caching, always hit real API | Debugging |

### Cache Key Design

The cache key is a deterministic SHA-256 hash of the operation's semantic inputs:

```
sha256(stableJsonStringify({ operationType, model, input, tools }))
```

This survives SDK upgrades, HTTP header changes, and transport-layer differences because it hashes the **intent**, not the wire format.

### Cassette Path Convention

```
__cassettes__/<suiteName>/<operationName>-<hash>.json
```

Cassette directories live **next to the test files**, not in a central location. Example:

```
packages/infra/ai/src/__tests__/
  __cassettes__/
    otel-sequential/
      planner-call-a1b2c3d4.json
      critic-call-e5f6a7b8.json
      finalizer-call-c9d0e1f2.json
  otel-sequential.integration.test.ts
```

### Scrubbing

Before writing cassettes, the scrubber strips secrets:

- `Authorization` headers → `[REDACTED]`
- `OPENROUTER_API_KEY` values → `[REDACTED]`
- Any key matching `/key|secret|token|password/i` in metadata → `[REDACTED]`

Configurable via `ScrubRule[]` passed to VCR options.

## File Structure

```
packages/testkit/src/vcr/
  index.ts           — re-exports all public API
  types.ts           — CassetteEntry<T>, VcrMode, VcrOptions, ScrubRule
  hasher.ts          — deterministic sha256(stableJsonStringify(input))
  cassette-store.ts  — read/write cassettes as JSON to __cassettes__/
  scrubber.ts        — strip API keys/secrets from recorded responses
  with-vcr.ts        — core withVcr<T>() helper
  cli.ts             — cache manager CLI (vcr:clear, vcr:list)
```

### Type Definitions (`types.ts`)

```typescript
import type { Schema } from 'effect'

export type VcrMode = 'replay' | 'record' | 'record-missing' | 'passthrough'

export interface ScrubRule {
  /** Regex pattern to match keys or values */
  readonly pattern: RegExp
  /** Replacement string (default: '[REDACTED]') */
  readonly replacement?: string
}

export interface VcrOptions {
  /** Directory for cassettes (default: __cassettes__ next to caller) */
  readonly cassetteDir?: string
  /** Override VCR_MODE env var */
  readonly mode?: VcrMode
  /** Additional scrub rules beyond defaults */
  readonly scrubRules?: readonly ScrubRule[]
  /** Custom serializer for non-JSON-safe values */
  readonly serialize?: (value: unknown) => unknown
  /** Custom deserializer */
  readonly deserialize?: (value: unknown) => unknown
}

export interface CassetteEntry<T> {
  readonly hash: string
  readonly suite: string
  readonly name: string
  readonly recordedAt: string
  readonly input: Record<string, unknown>
  readonly output: T
}
```

### Hasher (`hasher.ts`)

```typescript
import { createHash } from 'node:crypto'

/**
 * Deterministic hash of operation inputs.
 * Uses stable JSON stringify (sorted keys) to ensure
 * identical inputs always produce identical hashes.
 */
export function hashInputs(inputs: Record<string, unknown>): string {
  const stable = stableJsonStringify(inputs)
  return createHash('sha256').update(stable).digest('hex').slice(0, 16)
}

function stableJsonStringify(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj)
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(stableJsonStringify).join(',') + ']'
  }
  const sorted = Object.keys(obj as Record<string, unknown>).sort()
  const entries = sorted.map(
    (k) => `${JSON.stringify(k)}:${stableJsonStringify((obj as Record<string, unknown>)[k])}`
  )
  return '{' + entries.join(',') + '}'
}
```

### Cassette Store (`cassette-store.ts`)

```typescript
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { CassetteEntry } from './types.js'
import { scrub } from './scrubber.js'
import type { ScrubRule } from './types.js'

export function cassettePath(
  baseDir: string,
  suite: string,
  name: string,
  hash: string
): string {
  return join(baseDir, suite, `${name}-${hash}.json`)
}

export function readCassette<T>(path: string): CassetteEntry<T> | null {
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf-8')) as CassetteEntry<T>
}

export function writeCassette<T>(
  path: string,
  entry: CassetteEntry<T>,
  scrubRules: readonly ScrubRule[]
): void {
  const dir = path.substring(0, path.lastIndexOf('/'))
  mkdirSync(dir, { recursive: true })
  const scrubbed = scrub(entry, scrubRules)
  writeFileSync(path, JSON.stringify(scrubbed, null, 2) + '\n', 'utf-8')
}

export function listCassettes(baseDir: string): string[] {
  if (!existsSync(baseDir)) return []
  const files: string[] = []
  for (const suite of readdirSync(baseDir, { withFileTypes: true })) {
    if (!suite.isDirectory()) continue
    for (const file of readdirSync(join(baseDir, suite.name), { withFileTypes: true })) {
      if (file.name.endsWith('.json')) {
        files.push(join(suite.name, file.name))
      }
    }
  }
  return files
}
```

### Scrubber (`scrubber.ts`)

```typescript
import type { ScrubRule } from './types.js'

const DEFAULT_SCRUB_RULES: readonly ScrubRule[] = [
  { pattern: /^authorization$/i, replacement: '[REDACTED]' },
  { pattern: /key|secret|token|password/i, replacement: '[REDACTED]' },
]

export function scrub<T>(data: T, extraRules: readonly ScrubRule[] = []): T {
  const rules = [...DEFAULT_SCRUB_RULES, ...extraRules]
  return JSON.parse(JSON.stringify(data, (key, value) => {
    if (typeof key !== 'string' || typeof value !== 'string') return value
    for (const rule of rules) {
      if (rule.pattern.test(key)) {
        return rule.replacement ?? '[REDACTED]'
      }
    }
    return value
  })) as T
}
```

### Core `withVcr()` (`with-vcr.ts`)

```typescript
import { resolve, dirname } from 'node:path'
import { hashInputs } from './hasher.js'
import { cassettePath, readCassette, writeCassette } from './cassette-store.js'
import type { CassetteEntry, VcrMode, VcrOptions } from './types.js'

function getMode(options?: VcrOptions): VcrMode {
  if (options?.mode) return options.mode
  const env = process.env.VCR_MODE as VcrMode | undefined
  return env ?? 'record-missing'
}

/**
 * Wrap any async operation with VCR caching.
 *
 * @param suite   - Cassette suite name (groups related recordings)
 * @param name    - Operation name within the suite
 * @param inputKey - Object whose hash determines cache identity
 * @param fn      - The actual async operation to cache
 * @param options - VCR options (mode override, scrub rules, cassette dir)
 */
export async function withVcr<T>(
  suite: string,
  name: string,
  inputKey: Record<string, unknown>,
  fn: () => Promise<T>,
  options?: VcrOptions
): Promise<T> {
  const mode = getMode(options)

  if (mode === 'passthrough') {
    return fn()
  }

  const hash = hashInputs(inputKey)
  const baseDir = options?.cassetteDir ?? resolve(callerDir(), '__cassettes__')
  const path = cassettePath(baseDir, suite, name, hash)

  // Try replay
  if (mode === 'replay' || mode === 'record-missing') {
    const cached = readCassette<T>(path)
    if (cached) {
      return options?.deserialize
        ? options.deserialize(cached.output) as T
        : cached.output
    }
    if (mode === 'replay') {
      throw new Error(
        `VCR replay failed: no cassette at ${path}. ` +
        `Run with VCR_MODE=record to create it.`
      )
    }
  }

  // Record
  const result = await fn()
  const output = options?.serialize ? options.serialize(result) as T : result

  const entry: CassetteEntry<T> = {
    hash,
    suite,
    name,
    recordedAt: new Date().toISOString(),
    input: inputKey,
    output,
  }

  writeCassette(path, entry, options?.scrubRules ?? [])
  return result
}

/** Resolve __cassettes__ relative to the calling test file */
function callerDir(): string {
  // Use the test file path from vitest's expect.getState()
  // Fallback: walk the stack to find the first .test.ts file
  const err = new Error()
  const stack = err.stack?.split('\n') ?? []
  for (const line of stack) {
    const match = line.match(/\((.+\.test\.[tj]s):\d+:\d+\)/)
    if (match) return dirname(match[1])
  }
  return process.cwd()
}
```

### Index (`index.ts`)

```typescript
export { withVcr } from './with-vcr.js'
export { hashInputs } from './hasher.js'
export { scrub } from './scrubber.js'
export { readCassette, writeCassette, listCassettes, cassettePath } from './cassette-store.js'
export type { CassetteEntry, VcrMode, VcrOptions, ScrubRule } from './types.js'
```

## Code Patterns

### Pattern 1: Generic `withVcr()` for Any Async Operation

Use `withVcr()` to cache any expensive async call — LLM, eval, embedding, image gen, or composite pipeline.

```typescript
import { withVcr } from '@tx-agent-kit/testkit/vcr'

// Cache an LLM call
const response = await withVcr('my-suite', 'planner-call', {
  model: 'openai/gpt-4.1-mini',
  input: messages,
}, async () => {
  return await realLlmCall(messages)
})

// Cache an eval score
const score = await withVcr('eval-suite', 'brand-safety', {
  content: artifact.text,
  rubric: 'brand-safety-v2',
}, async () => {
  return await evaluateBrandSafety(artifact)
})

// Cache a composite pipeline (multiple API calls as one unit)
const result = await withVcr('scoring', 'content-quality', {
  contentId: content.id,
}, async () => {
  const safety = await checkSafety(content)
  const relevance = await scoreRelevance(content, brief)
  return { safety, relevance, composite: (safety + relevance) / 2 }
})
```

### Pattern 2: `withVcr()` for Effect-Based AI Calls

This repo uses Effect for AI operations. Wrap the Effect runtime call:

```typescript
import { withVcr } from '@tx-agent-kit/testkit/vcr'
import { tracedCallModel } from '@tx-agent-kit/ai'
import { Effect } from 'effect'

describe('AI planner', () => {
  it('generates a plan', async () => {
    const result = await withVcr('planner', 'generate-plan', {
      model: 'openai/gpt-4.1-mini',
      input: [{ role: 'user', content: 'Write a plan for X' }],
    }, async () => {
      const program = tracedCallModel({
        model: 'openai/gpt-4.1-mini',
        input: [{ role: 'user', content: 'Write a plan for X' }],
        maxTokens: 200,
      })
      return await Effect.runPromise(program)
    })

    expect(result.output).toBeDefined()
    expect(result.usage.totalTokens).toBeGreaterThan(0)
  })
})
```

### Pattern 3: `withOpenRouterVcr()` — MSW-Powered HTTP Recording

For tests that need to capture the raw HTTP request/response (e.g. verifying headers, streaming chunks), combine MSW with VCR:

```typescript
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { withVcr, readCassette, writeCassette, hashInputs, cassettePath } from '@tx-agent-kit/testkit/vcr'
import { resolve } from 'node:path'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

/**
 * MSW-powered VCR for OpenRouter HTTP calls.
 * Records the raw HTTP response on first run, replays from cassette after.
 */
export function withOpenRouterVcr(
  suite: string,
  name: string,
  inputKey: Record<string, unknown>,
  fn: () => Promise<void>
): () => Promise<void> {
  return async () => {
    const hash = hashInputs(inputKey)
    const baseDir = resolve(__dirname, '__cassettes__')
    const path = cassettePath(baseDir, suite, name, hash)
    const cached = readCassette<{ status: number; body: unknown }>(path)

    if (cached) {
      // Replay mode: MSW serves the cached response
      const server = setupServer(
        http.post(OPENROUTER_URL, () => {
          return HttpResponse.json(cached.output.body, {
            status: cached.output.status,
          })
        })
      )
      server.listen({ onUnhandledRequest: 'bypass' })
      try {
        await fn()
      } finally {
        server.close()
      }
      return
    }

    // Record mode: let the real request through, capture it via MSW
    let captured: { status: number; body: unknown } | null = null
    const server = setupServer(
      http.post(OPENROUTER_URL, async ({ request }) => {
        const real = await fetch(request.clone())
        const body = await real.json()
        captured = { status: real.status, body }
        return HttpResponse.json(body, { status: real.status })
      })
    )
    server.listen({ onUnhandledRequest: 'bypass' })
    try {
      await fn()
      if (captured) {
        writeCassette(path, {
          hash,
          suite,
          name,
          recordedAt: new Date().toISOString(),
          input: inputKey,
          output: captured,
        }, [])
      }
    } finally {
      server.close()
    }
  }
}

// Usage in a test:
describe('OpenRouter HTTP', () => {
  it('captures raw response', withOpenRouterVcr(
    'openrouter-http',
    'chat-completion',
    { model: 'openai/gpt-4.1-mini', prompt: 'Hello' },
    async () => {
      const response = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'openai/gpt-4.1-mini', messages: [{ role: 'user', content: 'Hello' }] }),
      })
      expect(response.status).toBe(200)
    }
  ))
})
```

### Pattern 4: MSW-Only for Error Paths (No VCR)

For testing error handling, use MSW directly — no need to cache errors:

```typescript
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { tracedCallModel } from '@tx-agent-kit/ai'
import { Effect } from 'effect'

describe('error handling', () => {
  const server = setupServer()

  beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }))
  afterEach(() => server.resetHandlers())
  afterAll(() => server.close())

  it('handles rate limiting (429)', async () => {
    server.use(
      http.post('https://openrouter.ai/api/v1/chat/completions', () => {
        return HttpResponse.json(
          { error: { message: 'Rate limit exceeded', type: 'rate_limit_error' } },
          { status: 429, headers: { 'Retry-After': '5' } }
        )
      })
    )

    const program = tracedCallModel({
      model: 'openai/gpt-4.1-mini',
      input: [{ role: 'user', content: 'test' }],
    })

    const result = await Effect.runPromiseExit(program)
    expect(result._tag).toBe('Failure')
  })

  it('handles malformed response', async () => {
    server.use(
      http.post('https://openrouter.ai/api/v1/chat/completions', () => {
        return HttpResponse.text('not json', { status: 200 })
      })
    )

    const program = tracedCallModel({
      model: 'openai/gpt-4.1-mini',
      input: [{ role: 'user', content: 'test' }],
    })

    const result = await Effect.runPromiseExit(program)
    expect(result._tag).toBe('Failure')
  })

  it('handles 500 server error', async () => {
    server.use(
      http.post('https://openrouter.ai/api/v1/chat/completions', () => {
        return HttpResponse.json(
          { error: { message: 'Internal server error' } },
          { status: 500 }
        )
      })
    )

    const program = tracedCallModel({
      model: 'openai/gpt-4.1-mini',
      input: [{ role: 'user', content: 'test' }],
    })

    const result = await Effect.runPromiseExit(program)
    expect(result._tag).toBe('Failure')
  })
})
```

### Pattern 5: Writing a New VCR Test from Scratch

Complete test file for a new AI feature:

```typescript
// packages/infra/ai/src/__tests__/my-feature.integration.test.ts
import { describe, it, expect } from 'vitest'
import { Effect } from 'effect'
import { withVcr } from '@tx-agent-kit/testkit/vcr'
import { tracedCallModel, withAgentTrace, withAgentStep } from '@tx-agent-kit/ai'

describe('my AI feature', () => {
  it('runs a multi-step pipeline', async () => {
    const result = await withVcr(
      'my-feature',           // suite name
      'draft-review-pipeline', // operation name
      {                        // input key (determines cache identity)
        model: 'openai/gpt-4.1-mini',
        draftPrompt: 'Write a haiku about testing',
        reviewPrompt: 'Rate this haiku 1-10',
      },
      async () => {
        const program = withAgentTrace('my-feature-trace', {}, Effect.gen(function* () {
          const draft = yield* withAgentStep('draft', { type: 'generator' },
            tracedCallModel({
              model: 'openai/gpt-4.1-mini',
              input: [{ role: 'user', content: 'Write a haiku about testing' }],
              maxTokens: 50,
            })
          )

          const draftText = draft.output
            .filter((m): m is { type: 'message'; role: 'assistant'; content: Array<{ type: 'text'; text: string }> } =>
              m.type === 'message')
            .flatMap((m) => m.content.filter((c): c is { type: 'text'; text: string } => c.type === 'text'))
            .map((c) => c.text)
            .join('')

          const review = yield* withAgentStep('review', { type: 'critic' },
            tracedCallModel({
              model: 'openai/gpt-4.1-mini',
              input: [
                { role: 'user', content: `Rate this haiku 1-10: ${draftText}` },
              ],
              maxTokens: 20,
            })
          )

          return { draft, review }
        }))

        return await Effect.runPromise(program)
      }
    )

    expect(result.draft.usage.totalTokens).toBeGreaterThan(0)
    expect(result.review.usage.totalTokens).toBeGreaterThan(0)
  })
})
```

## Steps — Converting an Existing `RUN_LIVE_INTEGRATION` Test

This converts tests that currently require a live API key and `RUN_LIVE_INTEGRATION=1`.

### 1. Add testkit VCR dependency

Ensure the package has `@tx-agent-kit/testkit` as a `devDependency`:

```json
{
  "devDependencies": {
    "@tx-agent-kit/testkit": "workspace:*"
  }
}
```

### 2. Remove the skip guard

**Before:**
```typescript
const shouldRunAiIntegration = process.env.RUN_LIVE_INTEGRATION === '1'
describe.skipIf(!shouldRunAiIntegration)('AI tracing integration', () => {
```

**After:**
```typescript
describe('AI tracing integration', () => {
```

### 3. Wrap each test's async operation with `withVcr()`

**Before** (from `tracing.integration.test.ts`):
```typescript
it('should trace a basic model call', async () => {
  const response = await Effect.runPromise(
    tracedCallModel({
      model: 'openai/gpt-4.1-mini',
      input: [{ role: 'user', content: 'Say "hello" in one word.' }],
      maxTokens: 10,
    })
  )
  expect(response.usage.totalTokens).toBeGreaterThan(0)
})
```

**After:**
```typescript
it('should trace a basic model call', async () => {
  const response = await withVcr(
    'tracing',
    'basic-model-call',
    { model: 'openai/gpt-4.1-mini', input: 'Say hello in one word' },
    async () => Effect.runPromise(
      tracedCallModel({
        model: 'openai/gpt-4.1-mini',
        input: [{ role: 'user', content: 'Say "hello" in one word.' }],
        maxTokens: 10,
      })
    )
  )
  expect(response.usage.totalTokens).toBeGreaterThan(0)
})
```

### 4. First recording run

```bash
# Record cassettes by hitting the real API
VCR_MODE=record OPENROUTER_API_KEY=your-key pnpm vitest run packages/infra/ai/src/__tests__/my-test.integration.test.ts

# Verify cassettes were created
ls packages/infra/ai/src/__tests__/__cassettes__/
```

### 5. Verify replay works

```bash
# Should pass without an API key
VCR_MODE=replay pnpm vitest run packages/infra/ai/src/__tests__/my-test.integration.test.ts
```

### 6. Commit the cassettes

```bash
git add packages/infra/ai/src/__tests__/__cassettes__/
git commit -m "test: add VCR cassettes for AI integration tests"
```

## Steps — Adding a New Scrub Rule

### 1. Define the rule

```typescript
import { withVcr } from '@tx-agent-kit/testkit/vcr'
import type { ScrubRule } from '@tx-agent-kit/testkit/vcr'

const customRules: ScrubRule[] = [
  { pattern: /^x-custom-auth$/i, replacement: '[REDACTED]' },
  { pattern: /^api[-_]?key$/i },  // uses default '[REDACTED]'
]
```

### 2. Pass to `withVcr()` options

```typescript
const result = await withVcr('suite', 'name', inputKey, fn, {
  scrubRules: customRules,
})
```

## Steps — Re-Recording Cassettes

When prompts, models, or schemas change, cassettes become stale.

### Re-record a single suite

```bash
VCR_MODE=record OPENROUTER_API_KEY=your-key pnpm vitest run path/to/test.ts
```

### Re-record everything

```bash
VCR_MODE=record OPENROUTER_API_KEY=your-key pnpm test:integration
```

### Clear stale cassettes first (optional)

```bash
pnpm vcr:clear --suite my-suite
VCR_MODE=record OPENROUTER_API_KEY=your-key pnpm vitest run path/to/test.ts
```

## Cache Manager CLI

### Package.json scripts

Add to root `package.json`:

```json
{
  "scripts": {
    "vcr:clear": "tsx packages/testkit/src/vcr/cli.ts clear",
    "vcr:list": "tsx packages/testkit/src/vcr/cli.ts list"
  }
}
```

### CLI Implementation (`cli.ts`)

```typescript
import { readdirSync, statSync, rmSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { listCassettes } from './cassette-store.js'

const args = process.argv.slice(2)
const command = args[0]

/** Find all __cassettes__ dirs in the repo */
function findCassetteDirs(root: string): string[] {
  const dirs: string[] = []
  function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === '__cassettes__') dirs.push(full)
        else walk(full)
      }
    }
  }
  walk(root)
  return dirs
}

const root = process.cwd()

if (command === 'clear') {
  const suite = args.find((a) => a.startsWith('--suite='))?.split('=')[1]
    ?? (args.indexOf('--suite') >= 0 ? args[args.indexOf('--suite') + 1] : undefined)
  const pattern = args.find((a) => a.startsWith('--pattern='))?.split('=')[1]
    ?? (args.indexOf('--pattern') >= 0 ? args[args.indexOf('--pattern') + 1] : undefined)

  for (const dir of findCassetteDirs(root)) {
    if (suite) {
      const suiteDir = join(dir, suite)
      if (existsSync(suiteDir)) {
        rmSync(suiteDir, { recursive: true })
        console.log(`Cleared: ${relative(root, suiteDir)}`)
      }
    } else if (pattern) {
      for (const file of listCassettes(dir)) {
        if (new RegExp(pattern.replace(/\*/g, '.*')).test(file)) {
          rmSync(join(dir, file))
          console.log(`Deleted: ${relative(root, join(dir, file))}`)
        }
      }
    } else {
      rmSync(dir, { recursive: true })
      console.log(`Cleared: ${relative(root, dir)}`)
    }
  }
} else if (command === 'list') {
  const staleArg = args.find((a) => a.startsWith('--stale='))?.split('=')[1]
    ?? (args.indexOf('--stale') >= 0 ? args[args.indexOf('--stale') + 1] : undefined)
  const staleDays = staleArg ? parseInt(staleArg, 10) : undefined
  const now = Date.now()

  for (const dir of findCassetteDirs(root)) {
    for (const file of listCassettes(dir)) {
      const full = join(dir, file)
      const stat = statSync(full)
      const ageDays = Math.floor((now - stat.mtimeMs) / 86_400_000)
      const sizeKb = (stat.size / 1024).toFixed(1)

      if (staleDays && ageDays < staleDays) continue
      console.log(`${relative(root, full)}  ${ageDays}d  ${sizeKb}KB`)
    }
  }
} else {
  console.log('Usage:')
  console.log('  pnpm vcr:clear                          # wipe ALL cassettes')
  console.log('  pnpm vcr:clear --suite <name>            # wipe one suite')
  console.log('  pnpm vcr:clear --pattern "planner*"      # wipe by glob')
  console.log('  pnpm vcr:list                            # list all with age + size')
  console.log('  pnpm vcr:list --stale 30                 # show cassettes > 30 days old')
}
```

### CLI Commands

```bash
pnpm vcr:clear                              # wipe ALL cassettes
pnpm vcr:clear --suite otel-sequential   # wipe one suite
pnpm vcr:clear --pattern "planner*"          # wipe by glob
pnpm vcr:list                                # list all with age + size
pnpm vcr:list --stale 30                     # show cassettes > 30 days old
```

## Decision Rules

### When to Use VCR vs MSW vs Both

| Scenario | Use | Why |
|----------|-----|-----|
| Cache an LLM/eval/embedding call | **VCR only** | Operation-level is simplest, survives SDK changes |
| Cache any non-HTTP async operation | **VCR only** | VCR works at the function level, not transport |
| Test error responses (429, 500) | **MSW only** | Errors shouldn't be cached; MSW gives precise control |
| Test streaming edge cases | **MSW only** | Need to control chunk timing and partial responses |
| Test malformed API responses | **MSW only** | Need to return invalid payloads |
| Capture raw HTTP req/res pairs | **MSW + VCR** | MSW intercepts the wire, VCR persists it |
| Verify request headers/auth | **MSW + VCR** | Need HTTP-level visibility |

### Cassette Lifecycle

**Commit cassettes to git.** They are deterministic test fixtures with secrets scrubbed. Benefits:
- CI runs without API keys
- Tests are reproducible across machines
- PR reviews can inspect the actual API responses

**When to invalidate / re-record:**
- Model changed (e.g. `gpt-4.1-mini` → `gpt-4.1`)
- Prompt text changed
- Tool/function schema changed
- Response schema expectations changed
- Cassette > 90 days old (model behavior may have drifted)

**When NOT to re-record:**
- SDK version bumped (cache key is operation-level, not HTTP-level)
- Refactored test structure without changing inputs
- Added new tests (existing cassettes unaffected)

### Environment Variable Summary

| Variable | Values | Default | Purpose |
|----------|--------|---------|---------|
| `VCR_MODE` | `replay`, `record`, `record-missing`, `passthrough` | `record-missing` | Controls VCR behavior |
| `OPENROUTER_API_KEY` | API key string | — | Required for `record` / `record-missing` modes |

CI should set `VCR_MODE=replay` to ensure tests never hit real APIs.

## Reference Files

| File | Role |
|------|------|
| `packages/testkit/src/vcr/index.ts` | VCR public API re-exports |
| `packages/testkit/src/vcr/types.ts` | `CassetteEntry<T>`, `VcrMode`, `VcrOptions`, `ScrubRule` |
| `packages/testkit/src/vcr/hasher.ts` | Deterministic SHA-256 hash of operation inputs |
| `packages/testkit/src/vcr/cassette-store.ts` | Read/write/list cassette JSON files |
| `packages/testkit/src/vcr/scrubber.ts` | Strip secrets from recorded responses |
| `packages/testkit/src/vcr/with-vcr.ts` | Core `withVcr<T>()` caching wrapper |
| `packages/testkit/src/vcr/cli.ts` | Cache manager CLI (`vcr:clear`, `vcr:list`) |
| `packages/infra/ai/src/__tests__/otel-sequential.integration.test.ts` | Multi-step agent pipeline test (conversion target) |
| `packages/infra/ai/src/tracing.integration.test.ts` | Tracing infrastructure test (conversion target) |
| `packages/infra/ai/src/tracing.ts` | `tracedCallModel`, `withAgentStep`, `withAgentTrace` |
| `packages/infra/ai/src/openrouter.ts` | OpenRouter client + `callModel` |
