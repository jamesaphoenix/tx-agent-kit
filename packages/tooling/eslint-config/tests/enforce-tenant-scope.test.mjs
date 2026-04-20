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
          'domain-structure/enforce-tenant-scope': 'error'
        }
      }
    ]
  })

  const [result] = await eslint.lintText(code, { filePath })
  return result.messages
}

const REPO_PATH = 'packages/infra/db/src/repositories/teams.ts'
const NON_REPO_PATH = 'packages/core/src/domains/team/application/team-service.ts'

test('enforce-tenant-scope: flags select().from(tenantScopedTable) without tenant scope in .where()', async () => {
  const messages = await runRule({
    filePath: REPO_PATH,
    code: `
import { eq } from 'drizzle-orm'
import { teamMembers } from '../schema.js'

const db = {} as any

// BAD: no .where() with teamId or organizationId
const result = db.select().from(teamMembers)
    `
  })

  assert.equal(messages.length, 1)
  assert.ok(messages[0].message.includes('INV-TEN-004'))
  assert.ok(messages[0].message.includes('teamMembers'))
})

test('enforce-tenant-scope: allows select().from(tenantScopedTable) with teamId in .where()', async () => {
  const messages = await runRule({
    filePath: REPO_PATH,
    code: `
import { eq } from 'drizzle-orm'
import { teamMembers } from '../schema.js'

const db = {} as any
const teamId = 'some-uuid'

// GOOD: .where() includes teamId
const result = db.select().from(teamMembers).where(eq(teamMembers.teamId, teamId))
    `
  })

  assert.equal(messages.length, 0)
})

test('enforce-tenant-scope: allows select().from(tenantScopedTable) with organizationId in .where()', async () => {
  const messages = await runRule({
    filePath: REPO_PATH,
    code: `
import { eq } from 'drizzle-orm'
import { orgMembers } from '../schema.js'

const db = {} as any
const orgId = 'some-uuid'

// GOOD: .where() includes organizationId
const result = db.select().from(orgMembers).where(eq(orgMembers.organizationId, orgId))
    `
  })

  assert.equal(messages.length, 0)
})

test('enforce-tenant-scope: flags delete(tenantScopedTable) without tenant scope', async () => {
  const messages = await runRule({
    filePath: REPO_PATH,
    code: `
import { eq } from 'drizzle-orm'
import { invitations } from '../schema.js'

const db = {} as any

// BAD: delete without tenant scoping
const result = db.delete(invitations).where(eq(invitations.id, 'some-id'))
    `
  })

  assert.equal(messages.length, 1)
  assert.ok(messages[0].message.includes('INV-TEN-004'))
  assert.ok(messages[0].message.includes('invitations'))
})

test('enforce-tenant-scope: allows delete(tenantScopedTable) with organizationId in .where()', async () => {
  const messages = await runRule({
    filePath: REPO_PATH,
    code: `
import { and, eq } from 'drizzle-orm'
import { invitations } from '../schema.js'

const db = {} as any

// GOOD: delete with tenant scope
const result = db.delete(invitations).where(
  and(eq(invitations.organizationId, 'org-id'), eq(invitations.id, 'some-id'))
)
    `
  })

  assert.equal(messages.length, 0)
})

test('enforce-tenant-scope: does not flag non-tenant-scoped tables', async () => {
  const messages = await runRule({
    filePath: REPO_PATH,
    code: `
import { eq } from 'drizzle-orm'
import { users } from '../schema.js'

const db = {} as any

// OK: users is not tenant-scoped
const result = db.select().from(users)
    `
  })

  assert.equal(messages.length, 0)
})

test('enforce-tenant-scope: does not flag outside repository files', async () => {
  const messages = await runRule({
    filePath: NON_REPO_PATH,
    code: `
import { eq } from 'drizzle-orm'
import { teamMembers } from '../schema.js'

const db = {} as any

// This would be bad in a repo, but this file is not in repositories/
const result = db.select().from(teamMembers)
    `
  })

  assert.equal(messages.length, 0)
})

test('enforce-tenant-scope: flags update(tenantScopedTable) without tenant scope', async () => {
  const messages = await runRule({
    filePath: REPO_PATH,
    code: `
import { eq } from 'drizzle-orm'
import { orgMembers } from '../schema.js'

const db = {} as any

// BAD: update without tenant scoping
const result = db.update(orgMembers).set({ role: 'admin' }).where(eq(orgMembers.id, 'some-id'))
    `
  })

  assert.equal(messages.length, 1)
  assert.ok(messages[0].message.includes('INV-TEN-004'))
})

test('enforce-tenant-scope: allows update with tenant scope', async () => {
  const messages = await runRule({
    filePath: REPO_PATH,
    code: `
import { and, eq } from 'drizzle-orm'
import { orgMembers } from '../schema.js'

const db = {} as any

// GOOD: update with tenant scope
const result = db.update(orgMembers)
  .set({ role: 'admin' })
  .where(and(eq(orgMembers.organizationId, 'org-id'), eq(orgMembers.id, 'some-id')))
    `
  })

  assert.equal(messages.length, 0)
})
