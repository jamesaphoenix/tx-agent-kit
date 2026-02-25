import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createSqlTestContext } from './sql-context.js'
import {
  invitationIdentityTriggerName,
  organizationUpdatedAtTriggerName,
  orgMembersUpdatedAtTriggerName
} from './db-triggers.js'

const sqlContext = createSqlTestContext({
  schemaPrefix: 'triggers'
})

beforeAll(async () => {
  await sqlContext.setup()
})

beforeEach(async () => {
  await sqlContext.reset()
})

afterAll(async () => {
  await sqlContext.teardown()
})

describe('database triggers integration', () => {
  it('installs expected trigger names', async () => {
    await sqlContext.withSchemaClient(async (client) => {
      const triggerRows = await client.query<{ triggerName: string }>(
        `
          SELECT trigger_name AS "triggerName"
          FROM information_schema.triggers
          WHERE event_object_schema = current_schema()
        `
      )

      const triggerNames = new Set(triggerRows.rows.map((row) => row.triggerName))

      expect(triggerNames.has(organizationUpdatedAtTriggerName)).toBe(true)
      expect(triggerNames.has(orgMembersUpdatedAtTriggerName)).toBe(true)
      expect(triggerNames.has(invitationIdentityTriggerName)).toBe(true)
    })
  })

  it('normalizes invitation email and binds invitee identity automatically', async () => {
    await sqlContext.withSchemaClient(async (client) => {
      const inviterId = randomUUID()
      const inviteeId = randomUUID()
      const organizationId = randomUUID()
      const invitationId = randomUUID()
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

      await client.query(
        `
          INSERT INTO users (id, email, password_hash, name)
          VALUES
            ($1, 'inviter@example.com', 'hash', 'Inviter'),
            ($2, 'invitee@example.com', 'hash', 'Invitee')
        `,
        [inviterId, inviteeId]
      )

      await client.query(
        `
          INSERT INTO organizations (id, name)
          VALUES ($1, 'Invitation Trigger Organization')
        `,
        [organizationId]
      )

      await client.query(
        `
          INSERT INTO org_members (organization_id, user_id, role)
          VALUES ($1, $2, 'owner')
        `,
        [organizationId, inviterId]
      )

      await client.query(
        `
          INSERT INTO invitations (
            id,
            organization_id,
            email,
            role,
            status,
            invited_by_user_id,
            token,
            expires_at
          )
          VALUES ($1, $2, $3, 'member', 'pending', $4, $5, $6)
        `,
        [
          invitationId,
          organizationId,
          '  INVITEE@EXAMPLE.COM  ',
          inviterId,
          `trigger-token-${randomUUID()}`,
          expiresAt
        ]
      )

      const invitationResult = await client.query<{ email: string; inviteeUserId: string | null }>(
        `
          SELECT email, invitee_user_id AS "inviteeUserId"
          FROM invitations
          WHERE id = $1
        `,
        [invitationId]
      )

      expect(invitationResult.rows[0]?.email).toBe('invitee@example.com')
      expect(invitationResult.rows[0]?.inviteeUserId).toBe(inviteeId)
    })
  })
})
