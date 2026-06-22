import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { Effect, Schema } from 'effect'
import { DB, provideDB } from '../client.js'
import { lifecycleMilestoneRowSchema } from '../effect-schemas/lifecycle-milestones.js'
import { toDbError } from '../errors.js'
import {
  authLoginSessions,
  invitations,
  lifecycleMilestones,
  orgMembers,
  organizations,
  teamMediaAssets,
  teams,
  usageRecords
} from '../schema.js'
import { createNullableDecoder } from './sql-helpers.js'

/**
 * One team's activity facts, used by the activity scan to decide which lifecycle
 * events to emit for the generic SaaS starter. `ownerUserId` is the event
 * recipient (the org owner the team belongs to). Several facts are org-level
 * (onboarding, recorded usage, subscription, last activity) and are projected
 * onto each team via its organization so the per-team scan can evaluate every
 * design predicate without a second pass.
 */
export interface TeamActivityFacts {
  teamId: string
  organizationId: string
  ownerUserId: string
  createdAt: Date
  /** organizations.onboarding_data->>'completedAt' is non-null. */
  onboardingCompleted: boolean
  /** First real workspace signal: a non-deleted asset OR a pending/accepted invitation in the org. */
  realWorkspaceSignals: number
  /** First recorded metered usage for the org. */
  recordedUsage: number
  /** Subscription is cancelled / lapsed (status = canceled OR ends_at in the past). */
  subscriptionCancelled: boolean
  /** max(login last_seen_at across org members, usage recorded_at) - the activity high-water mark. */
  lastActiveAt: Date | null
}

// Decoder for the activity-scan projection (a computed join, not a table row,
// so the schema lives here rather than under effect-schemas/, which is reserved
// for 1:1 table-row schemas). Counts are cast to int in SQL so they decode as
// numbers; `ownerUserId` is nullable and those rows are dropped (no recipient).
const teamActivityRowSchema = Schema.Struct({
  teamId: Schema.UUID,
  organizationId: Schema.UUID,
  createdAt: Schema.DateFromSelf,
  ownerUserId: Schema.NullOr(Schema.UUID),
  onboardingCompleted: Schema.Boolean,
  realWorkspaceSignals: Schema.Number,
  recordedUsage: Schema.Number,
  subscriptionCancelled: Schema.Boolean,
  // max(last_seen_at / recorded_at) is a computed column: the pg driver hands it
  // back as a raw timestamp string (it only auto-parses declared timestamp
  // columns), so accept either and coerce to a Date below.
  lastActiveAt: Schema.NullOr(Schema.Union(Schema.DateFromSelf, Schema.String))
})
const decodeTeamActivityRows = Schema.decodeUnknown(Schema.Array(teamActivityRowSchema))
const decodeNullableMilestone = createNullableDecoder(lifecycleMilestoneRowSchema, 'lifecycle milestone row')

const toTeamActivityFacts = (
  row: Schema.Schema.Type<typeof teamActivityRowSchema>
): TeamActivityFacts | null =>
  row.ownerUserId === null
    ? null
    : {
        teamId: row.teamId,
        organizationId: row.organizationId,
        ownerUserId: row.ownerUserId,
        createdAt: row.createdAt,
        onboardingCompleted: row.onboardingCompleted,
        realWorkspaceSignals: row.realWorkspaceSignals,
        recordedUsage: row.recordedUsage,
        subscriptionCancelled: row.subscriptionCancelled,
        lastActiveAt: row.lastActiveAt === null ? null : new Date(row.lastActiveAt)
      }

export const lifecycleScanRepository = {
  /**
   * Fetch one page of teams (most recent first) with the activity facts the
   * design's activity-scan predicates evaluate:
   *
   * - has_not_completed_onboarding -> `onboardingCompleted`
   *   (organizations.onboarding_data->>'completedAt' IS NULL)
   * - has_no_real_workspace        -> `realWorkspaceSignals = 0`
   *   (no non-deleted team_media_assets AND no pending/accepted invitations)
   * - has_recorded_usage           -> `recordedUsage > 0`
   *   (any usage_records row in a billable category for the org)
   * - subscription_cancelled       -> `subscriptionCancelled`
   * - no_activity_since            -> `lastActiveAt`
   *   (GREATEST of max login last_seen_at across org members and max usage recorded_at)
   *
   * Teams whose org has no owner are skipped (no recipient to email).
   * Keyset-paginated by `(created_at, id)` so the scan loops through ALL teams.
   */
  fetchTeamActivity: (limit: number, cursor?: { createdAt: Date; teamId: string }) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB

        const onboardingCompleted = sql<boolean>`(${organizations.onboardingData} ->> 'completedAt') IS NOT NULL`

        // A non-deleted asset in any of the org's teams OR a pending/accepted
        // invitation in the org is the "first real workspace" signal.
        const realWorkspaceSignals = sql<number>`(
          (SELECT count(*)::int FROM ${teamMediaAssets} tma
             JOIN ${teams} t2 ON t2.id = tma.team_id
            WHERE t2.organization_id = ${organizations.id}
              AND tma.is_deleted = false)
          +
          (SELECT count(*)::int FROM ${invitations} i
            WHERE i.organization_id = ${organizations.id}
              AND i.status IN ('pending', 'accepted'))
        )`

        const recordedUsage = sql<number>`(
          SELECT count(*)::int FROM ${usageRecords} ur
          WHERE ur.organization_id = ${organizations.id}
            AND ur.category IN (
              'text_generation', 'image_generation', 'video_generation',
              'storage', 'workflow_execution', 'api_call'
            )
        )`

        const subscriptionCancelled = sql<boolean>`(
          ${organizations.subscriptionStatus} = 'canceled'
          OR (${organizations.subscriptionEndsAt} IS NOT NULL AND ${organizations.subscriptionEndsAt} < now())
        )`

        const lastActiveAt = sql<Date | null>`GREATEST(
          (SELECT max(${authLoginSessions.lastSeenAt})
             FROM ${orgMembers} m
             JOIN ${authLoginSessions}
               ON ${authLoginSessions.userId} = m.user_id
            WHERE m.organization_id = ${organizations.id}),
          (SELECT max(ur.recorded_at) FROM ${usageRecords} ur
            WHERE ur.organization_id = ${organizations.id})
        )`

        const rows = yield* db
          .select({
            teamId: teams.id,
            organizationId: teams.organizationId,
            createdAt: teams.createdAt,
            ownerUserId: organizations.ownerUserId,
            onboardingCompleted,
            realWorkspaceSignals,
            recordedUsage,
            subscriptionCancelled,
            lastActiveAt
          })
          .from(teams)
          .innerJoin(organizations, eq(organizations.id, teams.organizationId))
          .where(
            and(
              isNotNull(organizations.ownerUserId),
              cursor === undefined
                ? undefined
                : sql`(${teams.createdAt}, ${teams.id}) < (${cursor.createdAt}, ${cursor.teamId})`
            )
          )
          .orderBy(desc(teams.createdAt), desc(teams.id))
          .limit(limit)
          .execute()

        const decoded = yield* decodeTeamActivityRows(rows)
        return decoded.flatMap((row) => {
          const facts = toTeamActivityFacts(row)
          return facts ? [facts] : []
        })
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to fetch team activity for lifecycle scan', error)))
}

export const lifecycleMilestoneRepository = {
  /**
   * Batch-read existing (team, milestone) markers for several teams in one
   * query. The activity scan builds a Set from this once per page to decide
   * which checks have already fired, replacing one `hasTeamMilestone` round-trip
   * per (team, check). Served by `lifecycle_milestones_team_unique`.
   */
  findTeamMarkers: (teamIds: ReadonlyArray<string>) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        if (teamIds.length === 0) {
          return []
        }
        const rows = yield* db
          .select({ teamId: lifecycleMilestones.teamId, milestone: lifecycleMilestones.milestone })
          .from(lifecycleMilestones)
          .where(inArray(lifecycleMilestones.teamId, [...teamIds]))
          .execute()
        // team_id is nullable (user-scoped markers carry a null team_id); the IN
        // filter already excludes those, so narrow to non-null for the caller.
        return rows.flatMap((row) => (row.teamId === null ? [] : [{ teamId: row.teamId, milestone: row.milestone }]))
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to fetch lifecycle milestone markers for teams', error))),

  /** True if a (team, milestone) marker already exists. */
  hasTeamMilestone: (teamId: string, milestone: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .select({ id: lifecycleMilestones.id })
          .from(lifecycleMilestones)
          .where(and(eq(lifecycleMilestones.teamId, teamId), eq(lifecycleMilestones.milestone, milestone)))
          .limit(1)
          .execute()
        return rows.length > 0
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to read lifecycle milestone marker', error))),

  /**
   * Record a once-per-team milestone marker (e.g. a missed activation deadline).
   * Returns true only when the row is newly inserted, so the caller emits the
   * lifecycle event at most once per team per milestone regardless of how often
   * the scan runs. Backed by the partial-unique (team_id, milestone) index.
   */
  tryInsertTeamMilestone: (teamId: string, milestone: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .insert(lifecycleMilestones)
          .values({ teamId, userId: null, milestone })
          .onConflictDoNothing()
          .returning()
          .execute()
        // Empty on conflict (already recorded); a decoded row means newly inserted.
        const inserted = yield* decodeNullableMilestone(rows[0] ?? null)
        return inserted !== null
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to insert lifecycle milestone marker', error))),

  /**
   * Record a once-per-user milestone marker. Used by the feature_used (first
   * recorded usage) path so the activation celebration fires at most once per
   * user. Backed by the partial-unique (user_id, milestone) index.
   */
  tryInsertUserMilestone: (userId: string, milestone: string) =>
    provideDB(
      Effect.gen(function* () {
        const db = yield* DB
        const rows = yield* db
          .insert(lifecycleMilestones)
          .values({ userId, teamId: null, milestone })
          .onConflictDoNothing()
          .returning()
          .execute()
        const inserted = yield* decodeNullableMilestone(rows[0] ?? null)
        return inserted !== null
      })
    ).pipe(Effect.mapError((error) => toDbError('Failed to insert lifecycle user milestone marker', error)))
}
