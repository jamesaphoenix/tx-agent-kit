import assert from 'node:assert/strict'
import test from 'node:test'
import { ESLint } from 'eslint'
import tseslint from 'typescript-eslint'
import { domainStructurePlugin } from '../domain-structure-plugin.js'

const runRule = async ({ code, filePath }) => {
  const eslint = new ESLint({
    overrideConfigFile: true,
    ignore: false,
    overrideConfig: [
      {
        files: ['**/*.{ts,tsx,mts,cts}'],
        languageOptions: {
          parser: tseslint.parser,
          parserOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module'
          }
        },
        plugins: {
          'domain-structure': domainStructurePlugin
        },
        rules: {
          'domain-structure/no-swallowed-errors': 'error'
        }
      }
    ]
  })

  const [result] = await eslint.lintText(code, { filePath })
  return result.messages
}

const FILE_PATH = 'packages/core/src/domains/auth/application/auth-service.ts'
const TEMPORAL_ACTIVITY_FILE_PATH = 'apps/worker/src/activities.ts'
const TEMPORAL_WORKFLOW_FILE_PATH = 'apps/worker/src/workflows.ts'

test('no-swallowed-errors: flags Effect.tryPromise catch with no params', async () => {
  const messages = await runRule({
    filePath: FILE_PATH,
    code: `
import { Effect } from 'effect'
const result = Effect.tryPromise({
  try: async () => 'hello',
  catch: () => new Error('opaque error')
})
    `
  })
  assert.equal(messages.length, 1)
  assert.ok(messages[0].message.includes('catch handler must accept'))
})

test('no-swallowed-errors: allows Effect.tryPromise catch with error param', async () => {
  const messages = await runRule({
    filePath: FILE_PATH,
    code: `
import { Effect } from 'effect'
const result = Effect.tryPromise({
  try: async () => 'hello',
  catch: (error) => new Error(\`Failed: \${error}\`)
})
    `
  })
  assert.equal(messages.length, 0)
})

test('no-swallowed-errors: flags Effect.mapError with no params', async () => {
  const messages = await runRule({
    filePath: FILE_PATH,
    code: `
import { Effect } from 'effect'
const result = someEffect.pipe(
  Effect.mapError(() => new Error('opaque'))
)
    `
  })
  assert.equal(messages.length, 1)
  assert.ok(messages[0].message.includes('mapError handler must accept'))
})

test('no-swallowed-errors: allows Effect.mapError with error param', async () => {
  const messages = await runRule({
    filePath: FILE_PATH,
    code: `
import { Effect } from 'effect'
const result = someEffect.pipe(
  Effect.mapError((error) => new Error(\`Failed: \${error}\`))
)
    `
  })
  assert.equal(messages.length, 0)
})

test('no-swallowed-errors: flags Temporal catch blocks without an error binding', async () => {
  const messages = await runRule({
    filePath: TEMPORAL_ACTIVITY_FILE_PATH,
    code: `
export const runActivity = async () => {
  try {
    await publish()
  } catch {
    return { status: 'failed' }
  }
}
    `
  })

  assert.equal(messages.length, 1)
  assert.ok(messages[0].message.includes('Temporal activity/workflow catch blocks must bind'))
})

test('no-swallowed-errors: flags Temporal catch blocks that continue without error-level logging or failure markers', async () => {
  const messages = await runRule({
    filePath: TEMPORAL_ACTIVITY_FILE_PATH,
    code: `
export const runActivity = async () => {
  try {
    await publish()
  } catch (error) {
    logger.warn('Publish failed.', { error })
    return { status: 'failed' }
  }
}
    `
  })

  assert.equal(messages.length, 1)
  assert.ok(messages[0].message.includes('must not quietly continue'))
})

test('no-swallowed-errors: allows Temporal catch blocks that log at error level', async () => {
  const messages = await runRule({
    filePath: TEMPORAL_ACTIVITY_FILE_PATH,
    code: `
export const runActivity = async () => {
  try {
    await publish()
  } catch (error) {
    logger.error('Publish failed.', { error })
    return { status: 'failed' }
  }
}
    `
  })

  assert.equal(messages.length, 0)
})

test('no-swallowed-errors: allows Temporal catch blocks that rethrow', async () => {
  const messages = await runRule({
    filePath: TEMPORAL_WORKFLOW_FILE_PATH,
    code: `
export const runWorkflow = async () => {
  try {
    await publish()
  } catch (error) {
    throw error
  }
}
    `
  })

  assert.equal(messages.length, 0)
})

test('no-swallowed-errors: allows Temporal catch blocks that mark failure state', async () => {
  const messages = await runRule({
    filePath: TEMPORAL_WORKFLOW_FILE_PATH,
    code: `
export const runWorkflow = async () => {
  try {
    await publish()
  } catch (error) {
    await markEventFailed('event-id', error)
    return
  }
}
    `
  })

  assert.equal(messages.length, 0)
})

test('no-swallowed-errors: allows documented Temporal parser fallbacks', async () => {
  const messages = await runRule({
    filePath: TEMPORAL_ACTIVITY_FILE_PATH,
    code: `
export const parse = (rawText) => {
  try {
    return JSON.parse(rawText)
  } catch {
    // temporal-observability:allow-swallow Invalid provider JSON falls back to raw text.
    return { description: rawText }
  }
}
    `
  })

  assert.equal(messages.length, 0)
})

test('no-swallowed-errors: flags unannotated Effect.either in Temporal files', async () => {
  const messages = await runRule({
    filePath: TEMPORAL_ACTIVITY_FILE_PATH,
    code: `
import { Effect } from 'effect'
const outcome = run().pipe(
  Effect.either
)
    `
  })

  assert.equal(messages.length, 1)
  assert.ok(messages[0].message.includes('Effect.either'))
})

test('no-swallowed-errors: allows annotated Effect.either in Temporal files', async () => {
  const messages = await runRule({
    filePath: TEMPORAL_ACTIVITY_FILE_PATH,
    code: `
import { Effect } from 'effect'
const outcome = run().pipe(
  // temporal-observability:allow-swallow The error is converted into an explicit failed status below.
  Effect.either
)
    `
  })

  assert.equal(messages.length, 0)
})
