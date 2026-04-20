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
