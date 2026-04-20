import { desc, eq, sql } from 'drizzle-orm'
import { Effect } from 'effect'
import { storageUsageRowSchema } from '../effect-schemas/storage-usage.js'
import { storageUsage } from '../schema.js'
import { decodeFirst, withDb } from './repo-helpers.js'
import { createOptionalDecoder } from './sql-helpers.js'

const decode = createOptionalDecoder(storageUsageRowSchema, 'storage usage row')

export const storageUsageRepository = {
  /**
   * Read the org's current period's rollup (most recent `period_start`).
   * Used by monthly overage reconciliation to snapshot `current_bytes` vs
   * `plan_storage_limit`.
   */
  getCurrentForOrganization: (organizationId: string) =>
    withDb('Failed to get current storage usage row', (db) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select()
          .from(storageUsage)
          .where(eq(storageUsage.orgId, organizationId))
          .orderBy(desc(storageUsage.periodStart))
          .limit(1)
          .execute()
        return yield* decodeFirst(rows, decode)
      })
    ),

  /**
   * List organization ids whose **most-recent** storage_usage period has
   * rolled over (period_end < now). Driven by the nightly storage
   * reconciliation schedule — each returned org is a candidate for a
   * `reconcileMonthlyOverage` call, which remains idempotent via the
   * `reconcile:<orgId>:<monthTag>` ledger reference.
   *
   * The previous implementation used `selectDistinct(orgId)` over every
   * historical row whose `period_end < now`. Each nightly run therefore
   * reconsidered every long-closed historical period, scanning the entire
   * audit table and triggering reconcile attempts that were already
   * idempotent no-ops — pure wasted work. Worse, an org whose CURRENT
   * period was never created (no rollover row exists yet) would keep
   * reappearing on every nightly run forever.
   *
   * The fix selects only the LATEST period per org via DISTINCT ON, then
   * filters that latest period for expiry. Closed historical periods no
   * longer trigger reconcile attempts — only the current rollover that
   * actually needs settlement.
   *
   * @spec billing-and-pricing-design §"Monthly Storage Reconciliation"
   */
  listOrganizationIdsWithExpiredUsage: (now: Date) =>
    withDb('Failed to list orgs with expired storage usage rollups', (db) =>
      Effect.gen(function* () {
        // Typed via the explicit generic on db.execute so the boundary
        // row shape is modeled inline at the call site (the structural
        // type-safety lint forbids chained-cast escape hatches).
        const rows = yield* db.execute<{
          org_id: string
        }>(sql`
          SELECT latest.org_id
            FROM (
              SELECT DISTINCT ON (org_id) org_id, period_end
                FROM storage_usage
                ORDER BY org_id, period_end DESC
            ) AS latest
            WHERE latest.period_end < ${now.toISOString()}::timestamptz
        `)
        return rows.map((row) => row.org_id)
      })
    )
}
