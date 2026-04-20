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
          'domain-structure/enforce-auth-principal-usage': 'error'
        }
      }
    ]
  })

  const [result] = await eslint.lintText(code, { filePath })
  return result.messages
}

const ROUTE_PATH = 'apps/api/src/routes/teams.ts'
const NON_ROUTE_PATH = 'packages/core/src/domains/team/application/team-service.ts'

test('enforce-auth-principal-usage: flags yield* requireAuth without assignment in route handler', async () => {
  const messages = await runRule({
    filePath: ROUTE_PATH,
    code: `
function* handler() {
  yield* requireAuth
  const service = yield* TeamService
}
`
  })

  assert.equal(messages.length, 1)
  assert.match(messages[0].message, /must be assigned/)
})

test('enforce-auth-principal-usage: allows yield* requireAuth with assignment', async () => {
  const messages = await runRule({
    filePath: ROUTE_PATH,
    code: `
function* handler() {
  const principal = yield* requireAuth
  const service = yield* TeamService
}
`
  })

  assert.equal(messages.length, 0)
})

test('enforce-auth-principal-usage: ignores files outside apps/api/src/routes/', async () => {
  const messages = await runRule({
    filePath: NON_ROUTE_PATH,
    code: `
function* handler() {
  yield* requireAuth
}
`
  })

  assert.equal(messages.length, 0)
})

test('enforce-auth-principal-usage: allows yield* of other services without assignment', async () => {
  const messages = await runRule({
    filePath: ROUTE_PATH,
    code: `
function* handler() {
  const principal = yield* requireAuth
  yield* service.doSomething()
}
`
  })

  assert.equal(messages.length, 0)
})

test('enforce-auth-principal-usage: flags yield * requireAuth (with space) without assignment', async () => {
  const messages = await runRule({
    filePath: ROUTE_PATH,
    code: `
function* handler() {
  yield * requireAuth
}
`
  })

  assert.equal(messages.length, 1)
  assert.match(messages[0].message, /must be assigned/)
})
