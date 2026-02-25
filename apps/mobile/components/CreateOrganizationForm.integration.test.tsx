import React from 'react'
import { randomUUID } from 'node:crypto'
import { create, act } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { createUser } from '../../../packages/testkit/src/index.ts'
import { createMobileFactoryContext } from '../integration/support/mobile-integration-context'
import { waitFor } from '../integration/support/wait-for'
import { writeAuthToken } from '../lib/auth-token'
import { CreateOrganizationForm } from './CreateOrganizationForm'

const findByType = (root: ReturnType<typeof create>['root'], type: string) =>
  root.findAllByType(type as never)

describe('CreateOrganizationForm integration', () => {
  it('creates an organization through the real API and persists it in schema-backed storage', async () => {
    const factoryContext = createMobileFactoryContext()
    const createdUser = await createUser(factoryContext, {
      email: `mobile-organization-owner-${randomUUID()}@example.com`,
      password: 'strong-pass-12345',
      name: 'Mobile Organization Owner'
    })

    await writeAuthToken(createdUser.token)

    const onCreated = vi.fn()
    const organizationName = `Mobile Organization ${randomUUID()}`

    const tree = create(<CreateOrganizationForm onCreated={onCreated} />)
    const input = findByType(tree.root, 'TextInput')[0]

    await act(async () => {
      input?.props.onChangeText(organizationName)
    })

    const submitButton = findByType(tree.root, 'TouchableOpacity')[0]
    expect(submitButton?.props.disabled).toBe(false)

    await act(async () => {
      submitButton?.props.onPress()
    })

    await waitFor(() => onCreated.mock.calls.length === 1)

    const organizationCount = await factoryContext.testContext.withSchemaClient(async (client) => {
      const result = await client.query<{ count: string | number }>(
        `
          SELECT COUNT(*)::int AS count
          FROM organizations o
          INNER JOIN org_members m
            ON m.organization_id = o.id
          WHERE m.user_id = $1
            AND m.role = 'owner'::membership_role
            AND o.name = $2
        `,
        [createdUser.user.id, organizationName]
      )

      const rawCount = result.rows[0]?.count
      return typeof rawCount === 'number' ? rawCount : Number.parseInt(rawCount ?? '0', 10)
    })

    expect(organizationCount).toBe(1)
    expect(onCreated).toHaveBeenCalledTimes(1)
  })
})
