import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDbAuthContext } from './db-auth-context.js'
import { createOrganizationAndTeam } from './api-factories.js'

const apiCwd = resolve(dirname(fileURLToPath(import.meta.url)), '../../../apps/api')

const dbAuthContext = createDbAuthContext({
  apiCwd,
  host: '127.0.0.1',
  port: Number.parseInt(process.env.TESTKIT_INTEGRATION_API_PORT ?? '4102', 10),
  authSecret: 'testkit-integration-auth-secret-12345',
  corsOrigin: '*',
  sql: {
    schemaPrefix: 'testkit'
  }
})

beforeAll(async () => {
  await dbAuthContext.setup()
})

beforeEach(async () => {
  await dbAuthContext.reset()
})

afterAll(async () => {
  await dbAuthContext.teardown()
})

describe('db auth context integration', () => {
  it('supports create/login/delete user lifecycle', async () => {
    const createdUser = await dbAuthContext.createUser({
      email: 'testkit-auth-flow@example.com',
      password: 'strong-pass-12345',
      name: 'Testkit Auth Flow'
    })

    const loggedIn = await dbAuthContext.loginUser({
      email: createdUser.credentials.email,
      password: createdUser.credentials.password
    })

    expect(loggedIn.user.id).toBe(createdUser.user.id)
    expect(loggedIn.user.email).toBe(createdUser.credentials.email)

    const deleted = await dbAuthContext.deleteUser(loggedIn.token)
    expect(deleted.deleted).toBe(true)

    const meAfterDelete = await fetch(`${dbAuthContext.baseUrl}/v1/auth/me`, {
      method: 'GET',
      headers: dbAuthContext.testContext.headersForCase('testkit-auth-me-after-delete', {
        authorization: `Bearer ${loggedIn.token}`
      })
    })

    expect(meAfterDelete.status).toBe(401)
  })

  it('creates organizations via context factory helpers', async () => {
    const owner = await dbAuthContext.createUser({
      email: 'testkit-org-owner@example.com',
      password: 'strong-pass-12345',
      name: 'Testkit Organization Owner'
    })

    const organization = await dbAuthContext.createTeam({
      token: owner.token,
      name: 'Testkit Organization'
    })

    expect(organization.name).toBe('Testkit Organization')
  })

  it('creates organization/team records via direct DB seeding', async () => {
    const owner = await dbAuthContext.createUser({
      email: 'org-team-owner@example.com',
      password: 'strong-pass-12345',
      name: 'Org Team Owner'
    })

    const created = await createOrganizationAndTeam(dbAuthContext.apiFactoryContext, {
      ownerUserId: owner.user.id,
      organizationName: 'Integration Org',
      teamName: 'Integration Team'
    })

    expect(created.organization.name).toBe('Integration Org')
    expect(created.team.name).toBe('Integration Team')
    expect(created.team.organizationId).toBe(created.organization.id)
  })
})
