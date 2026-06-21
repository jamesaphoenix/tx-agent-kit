import { readFile } from 'node:fs/promises'
import { AUTO_FIX_ACTIVITY_TIMEOUT_MS } from '@tx-agent-kit/contracts'
import { describe, expect, it } from 'vitest'

/**
 * Determinism guard for the Temporal workflow bundle.
 *
 * `workflows.ts` is bundled into the Temporal workflow SANDBOX. A VALUE import
 * from `@tx-agent-kit/contracts` pulls the contracts runtime (effect/Schema)
 * into that bundle, and effect assigns `Error.stackTraceLimit` at module load —
 * which throws `WorkflowWorkerUnhandledFailure` in the sandbox and prevents the
 * workflow (and therefore every auto-fix run) from executing. This test fails if
 * anyone re-introduces a non-type import from contracts (or any other package)
 * into the workflow, so the bundle stays pure.
 */
describe('workflows.ts (Temporal sandbox) determinism', () => {
  it('imports @tx-agent-kit/contracts as types only', async () => {
    const src = await readFile(new URL('./workflows.ts', import.meta.url), 'utf8')
    const contractsImports = src.match(
      /import\s+(?:type\s+)?\{[^}]*\}\s+from\s+'@tx-agent-kit\/contracts'/g
    )
    expect(contractsImports, 'workflow must import the payload/result types from contracts').not.toBeNull()
    for (const statement of contractsImports ?? []) {
      // The whole statement must be `import type { ... }` — a mixed
      // `import { VALUE, type T }` would drag the contracts runtime in.
      expect(statement, `non-type contracts import in workflow: ${statement}`).toMatch(
        /^import\s+type\s+\{/
      )
    }
  })

  it('keeps the inlined ACTIVITY_TIMEOUT_MS in sync with AUTO_FIX_ACTIVITY_TIMEOUT_MS', async () => {
    // The workflow inlines the timeout (a contracts VALUE import would pull effect
    // into the sandbox), so this guards against the inline drifting from the
    // contract — the test file is NOT in the sandbox, so it may import the value.
    const src = await readFile(new URL('./workflows.ts', import.meta.url), 'utf8')
    const match = src.match(/const ACTIVITY_TIMEOUT_MS\s*=\s*([0-9*\s]+)/)
    expect(match, 'workflows.ts must define ACTIVITY_TIMEOUT_MS').not.toBeNull()
    const expr = (match?.[1] ?? '').trim()
    // Only digits / * / whitespace — safe to evaluate by multiplying the factors.
    const value = expr.split('*').reduce((product, factor) => product * Number(factor.trim()), 1)
    expect(value).toBe(AUTO_FIX_ACTIVITY_TIMEOUT_MS)
  })

  it('only runtime-imports @temporalio/workflow (no other package values in the bundle)', async () => {
    const src = await readFile(new URL('./workflows.ts', import.meta.url), 'utf8')
    // Every non-`import type` import line must be from @temporalio/workflow.
    const valueImports = (src.match(/^import\s+(?!type\b)[^\n]*from\s+'[^']+'/gm) ?? []).filter(
      (line) => !line.includes("'@temporalio/workflow'")
    )
    expect(valueImports, `unexpected runtime imports in workflow bundle: ${valueImports.join(', ')}`).toEqual([])
  })
})
