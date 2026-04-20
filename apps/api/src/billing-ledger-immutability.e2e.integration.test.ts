import { creditLedgerRepository } from '@tx-agent-kit/db'
import {
  createOrganization,
  createUser,
  seedOrgCredits
} from '@tx-agent-kit/testkit'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { createTestFixture } from './routes/test-helpers.js'

/**
 * End-to-end immutability tests for the credit_ledger and usage_records
 * financial audit tables. The DB triggers
 * `prevent_credit_ledger_mutation` / `prevent_usage_records_mutation`
 * reject every UPDATE and DELETE except the single FK cascade SET NULL
 * path (when an organization is deleted, org_id is set to NULL so the
 * row survives with a broken pointer instead of disappearing).
 *
 * The pgTAP suites exercise the trigger function directly; this test
 * drives it through raw SQL from the app layer so any future refactor
 * that introduces a new credit_ledger / usage_records mutation path
 * (e.g. an admin "adjust" flow) is caught at code review.
 *
 * @spec INV-BILLING-001 — credit_ledger is immutable
 * @spec INV-BILLING-002 — usage_records is immutable
 */

const { getFactoryContext } = createTestFixture({
  schemaPrefix: 'billing_ledger_immutability'
})

const runEffect = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
  Effect.runPromise(
    effect.pipe(
      Effect.mapError((e) => {
        const message = e instanceof Error ? e.message : String(e)
        return new Error(message, { cause: e instanceof Error ? e : undefined })
      })
    )
  )

describe('credit_ledger immutability (INV-BILLING-001)', () => {
  // @spec INV-BILLING-001
  it('rejects UPDATE on any column via raw SQL', async () => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx)
    const org = await createOrganization(ctx, { token: owner.token })
    await seedOrgCredits(ctx, org.id, 100_000)

    // Insert a real ledger row via the append path.
    const inserted = await runEffect(
      creditLedgerRepository.append({
        organizationId: org.id,
        entryType: 'purchase',
        amountDecimillicents: 50_000,
        reason: 'immutability test seed',
        referenceId: `immutability-${org.id}`
      })
    )
    expect(inserted).toBeDefined()
    // The seed above happens through the Effect Some path; grab the row id.
    const rowId = await ctx.testContext.withSchemaClient(async (client) => {
      const result = await client.query<{ id: string }>(
        `SELECT id FROM credit_ledger WHERE reference_id = $1`,
        [`immutability-${org.id}`]
      )
      return result.rows[0]?.id ?? null
    })
    expect(rowId).not.toBeNull()

    // Try to change the amount. MUST fail.
    type MutationCase = { label: string; sql: string; params: ReadonlyArray<string | null> }
    const cases: ReadonlyArray<MutationCase> = [
      { label: 'amount', sql: `UPDATE credit_ledger SET amount_decimillicents = 1 WHERE id = $1`, params: [rowId] },
      { label: 'entry_type', sql: `UPDATE credit_ledger SET entry_type = 'adjustment' WHERE id = $1`, params: [rowId] },
      { label: 'reason', sql: `UPDATE credit_ledger SET reason = 'tampered' WHERE id = $1`, params: [rowId] },
      { label: 'reference_id', sql: `UPDATE credit_ledger SET reference_id = 'tampered' WHERE id = $1`, params: [rowId] },
      { label: 'metadata', sql: `UPDATE credit_ledger SET metadata = '{"tampered":true}'::jsonb WHERE id = $1`, params: [rowId] },
      { label: 'balance_after', sql: `UPDATE credit_ledger SET balance_after = 99999 WHERE id = $1`, params: [rowId] },
      { label: 'created_at', sql: `UPDATE credit_ledger SET created_at = now() - INTERVAL '1 year' WHERE id = $1`, params: [rowId] }
    ]

    const caught: Array<{ label: string; result: string }> = []
    await ctx.testContext.withSchemaClient(async (client) => {
      for (const { label, sql, params } of cases) {
        try {
          await client.query(sql, [...params])
          caught.push({ label, result: 'SUCCEEDED unexpectedly' })
        } catch (error) {
          caught.push({ label, result: error instanceof Error ? error.message : String(error) })
        }
      }
    })

    // Every attempt must have thrown a message mentioning immutability.
    for (const entry of caught) {
      const row = entry as { label: string; result: string }
      expect(row.result).toContain('credit_ledger rows are immutable')
    }
  })

  // @spec INV-BILLING-001
  it('rejects DELETE via raw SQL', async () => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx)
    const org = await createOrganization(ctx, { token: owner.token })
    await seedOrgCredits(ctx, org.id, 100_000)

    await runEffect(
      creditLedgerRepository.append({
        organizationId: org.id,
        entryType: 'purchase',
        amountDecimillicents: 5000,
        reason: 'delete immutability test',
        referenceId: `delete-immutability-${org.id}`
      })
    )

    const error = await ctx.testContext
      .withSchemaClient(async (client) => {
        try {
          await client.query(
            `DELETE FROM credit_ledger WHERE reference_id = $1`,
            [`delete-immutability-${org.id}`]
          )
          return null
        } catch (error_) {
          return error_ instanceof Error ? error_.message : String(error_)
        }
      })

    expect(error).not.toBeNull()
    expect(error).toContain('credit_ledger rows are immutable')

    // Row still exists.
    const rowCount = await ctx.testContext.withSchemaClient(async (client) => {
      const result = await client.query<{ count: string }>(
        `SELECT count(*)::text FROM credit_ledger WHERE reference_id = $1`,
        [`delete-immutability-${org.id}`]
      )
      return Number.parseInt(result.rows[0]?.count ?? '0', 10)
    })
    expect(rowCount).toBe(1)
  })

  // @spec INV-BILLING-001
  it('permits the FK cascade SET NULL path when an organization is deleted', async () => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx)
    const org = await createOrganization(ctx, { token: owner.token })
    await seedOrgCredits(ctx, org.id, 100_000)

    // Write several ledger rows — every one should survive the org delete
    // with org_id set to NULL (the one allowed mutation path).
    await runEffect(
      creditLedgerRepository.append({
        organizationId: org.id,
        entryType: 'purchase',
        amountDecimillicents: 10_000,
        reason: 'cascade test row 1',
        referenceId: `cascade-1-${org.id}`
      })
    )
    await runEffect(
      creditLedgerRepository.append({
        organizationId: org.id,
        entryType: 'purchase',
        amountDecimillicents: 20_000,
        reason: 'cascade test row 2',
        referenceId: `cascade-2-${org.id}`
      })
    )

    const beforeCount = await ctx.testContext.withSchemaClient(async (client) => {
      const result = await client.query<{ count: string }>(
        `SELECT count(*)::text FROM credit_ledger WHERE organization_id = $1`,
        [org.id]
      )
      return Number.parseInt(result.rows[0]?.count ?? '0', 10)
    })
    expect(beforeCount).toBeGreaterThanOrEqual(2)

    // Delete the organization. The FK on credit_ledger.organization_id
    // is ON DELETE SET NULL, which should cascade through the trigger's
    // allowed exception branch without throwing.
    await ctx.testContext.withSchemaClient(async (client) => {
      await client.query(`DELETE FROM organizations WHERE id = $1`, [org.id])
    })

    // Ledger rows still exist but with org_id = NULL (preserving audit trail).
    const afterOrgIds = await ctx.testContext.withSchemaClient(async (client) => {
      const result = await client.query<{
        reference_id: string
        organization_id: string | null
      }>(
        `SELECT reference_id, organization_id FROM credit_ledger
         WHERE reference_id IN ($1, $2)`,
        [`cascade-1-${org.id}`, `cascade-2-${org.id}`]
      )
      return result.rows
    })
    expect(afterOrgIds).toHaveLength(2)
    for (const row of afterOrgIds) {
      expect(row.organization_id).toBeNull()
    }
  })
})

describe('usage_records immutability (INV-BILLING-002)', () => {
  // @spec INV-BILLING-002
  it('rejects UPDATE on any column via raw SQL', async () => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx)
    const org = await createOrganization(ctx, { token: owner.token })

    const insertedId = await ctx.testContext.withSchemaClient(async (client) => {
      const result = await client.query<{ id: string }>(
        `INSERT INTO usage_records (
           organization_id, category, quantity,
           unit_cost_decimillicents, total_cost_decimillicents,
           reference_id, recorded_at
         )
         VALUES ($1, 'text_generation', 5, 100, 500, $2, now())
         RETURNING id`,
        [org.id, `usage-immutability-${org.id}`]
      )
      return result.rows[0]?.id ?? ''
    })
    expect(insertedId).not.toBe('')

    type MutationCase = { label: string; sql: string; params: ReadonlyArray<string> }
    const cases: ReadonlyArray<MutationCase> = [
      { label: 'quantity', sql: `UPDATE usage_records SET quantity = 999 WHERE id = $1`, params: [insertedId] },
      { label: 'unit_cost', sql: `UPDATE usage_records SET unit_cost_decimillicents = 1 WHERE id = $1`, params: [insertedId] },
      { label: 'total_cost', sql: `UPDATE usage_records SET total_cost_decimillicents = 1 WHERE id = $1`, params: [insertedId] },
      { label: 'category', sql: `UPDATE usage_records SET category = 'image_generation' WHERE id = $1`, params: [insertedId] },
      { label: 'recorded_at', sql: `UPDATE usage_records SET recorded_at = now() - INTERVAL '1 year' WHERE id = $1`, params: [insertedId] }
    ]

    const results: Array<{ label: string; error: string | null }> = []
    await ctx.testContext.withSchemaClient(async (client) => {
      for (const { label, sql, params } of cases) {
        try {
          await client.query(sql, [...params])
          results.push({ label, error: null })
        } catch (error) {
          results.push({ label, error: error instanceof Error ? error.message : String(error) })
        }
      }
    })

    for (const r of results) {
      expect(r.error).not.toBeNull()
      expect(r.error ?? '').toContain('usage_records rows are immutable')
    }
  })

  // @spec INV-BILLING-002
  it('rejects DELETE via raw SQL', async () => {
    const ctx = getFactoryContext()
    const owner = await createUser(ctx)
    const org = await createOrganization(ctx, { token: owner.token })

    await ctx.testContext.withSchemaClient(async (client) => {
      await client.query(
        `INSERT INTO usage_records (
           organization_id, category, quantity,
           unit_cost_decimillicents, total_cost_decimillicents,
           reference_id, recorded_at
         )
         VALUES ($1, 'text_generation', 1, 100, 100, $2, now())`,
        [org.id, `usage-delete-${org.id}`]
      )
    })

    const error = await ctx.testContext.withSchemaClient(async (client) => {
      try {
        await client.query(
          `DELETE FROM usage_records WHERE reference_id = $1`,
          [`usage-delete-${org.id}`]
        )
        return null
      } catch (error_) {
        return error_ instanceof Error ? error_.message : String(error_)
      }
    })

    expect(error).not.toBeNull()
    expect(error).toContain('usage_records rows are immutable')
  })
})
