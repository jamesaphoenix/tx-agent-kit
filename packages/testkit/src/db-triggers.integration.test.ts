import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createSqlTestContext } from './sql-context.js'
import {
  invitationIdentityTriggerName,
  workspaceOwnerMembershipTriggerName
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

      expect(triggerNames.has(workspaceOwnerMembershipTriggerName)).toBe(true)
      expect(triggerNames.has(invitationIdentityTriggerName)).toBe(true)
    })
  })

  it('creates owner workspace membership automatically on workspace insert', async () => {
    await sqlContext.withSchemaClient(async (client) => {
      const ownerId = randomUUID()
      const workspaceId = randomUUID()

      await client.query(
        `
          INSERT INTO users (id, email, password_hash, name)
          VALUES ($1, $2, $3, $4)
        `,
        [ownerId, 'trigger-owner@example.com', 'hash', 'Trigger Owner']
      )

      await client.query(
        `
          INSERT INTO workspaces (id, name, owner_user_id)
          VALUES ($1, $2, $3)
        `,
        [workspaceId, 'Trigger Workspace', ownerId]
      )

      const membershipResult = await client.query<{ role: string; userId: string }>(
        `
          SELECT role::text AS role, user_id AS "userId"
          FROM workspace_members
          WHERE workspace_id = $1
        `,
        [workspaceId]
      )

      expect(membershipResult.rows).toHaveLength(1)
      expect(membershipResult.rows[0]?.role).toBe('owner')
      expect(membershipResult.rows[0]?.userId).toBe(ownerId)
    })
  })

  it('reassigns owner role membership when workspace owner changes', async () => {
    await sqlContext.withSchemaClient(async (client) => {
      const firstOwnerId = randomUUID()
      const secondOwnerId = randomUUID()
      const workspaceId = randomUUID()

      await client.query(
        `
          INSERT INTO users (id, email, password_hash, name)
          VALUES
            ($1, 'first-owner@example.com', 'hash', 'First Owner'),
            ($2, 'second-owner@example.com', 'hash', 'Second Owner')
        `,
        [firstOwnerId, secondOwnerId]
      )

      await client.query(
        `
          INSERT INTO workspaces (id, name, owner_user_id)
          VALUES ($1, 'Owner Reassignment Workspace', $2)
        `,
        [workspaceId, firstOwnerId]
      )

      await client.query(
        `
          UPDATE workspaces
          SET owner_user_id = $2
          WHERE id = $1
        `,
        [workspaceId, secondOwnerId]
      )

      const ownerMemberships = await client.query<{ userId: string; role: string }>(
        `
          SELECT user_id AS "userId", role::text AS role
          FROM workspace_members
          WHERE workspace_id = $1
          ORDER BY user_id ASC
        `,
        [workspaceId]
      )

      expect(ownerMemberships.rows.filter((row) => row.role === 'owner')).toEqual([
        { userId: secondOwnerId, role: 'owner' }
      ])
      expect(
        ownerMemberships.rows.find((row) => row.userId === firstOwnerId)?.role
      ).toBe('admin')
    })
  })

  it('normalizes invitation email and binds invitee identity automatically', async () => {
    await sqlContext.withSchemaClient(async (client) => {
      const inviterId = randomUUID()
      const inviteeId = randomUUID()
      const workspaceId = randomUUID()
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
          INSERT INTO workspaces (id, name, owner_user_id)
          VALUES ($1, 'Invitation Trigger Workspace', $2)
        `,
        [workspaceId, inviterId]
      )

      await client.query(
        `
          INSERT INTO invitations (
            id,
            workspace_id,
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
          workspaceId,
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
