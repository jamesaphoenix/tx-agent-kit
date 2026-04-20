---
kind: spec
spec_type: design
doc_id: doc-38639a92ecb0
name: tenancy-model-design
title: "Tenancy Model"
status: active
version: 3
owners:
  - jamesaphoenix
summary: "Auth, identity, organization/team hierarchy, RBAC, client review, and tenant isolation for tx-agent-kit."
domain: tenancy-model
tags:
  - design
  - tenancy
  - auth
  - rbac
depends_on: []
supersedes: []
implements: tenancy-model-prd
last_reviewed_at: 2026-04-17
---

# Summary

tx-agent-kit uses a three-level hierarchy: **Organization > Team > User**. Organizations are billing
entities. Teams are workspace containers that own social accounts, content, and media. Users belong
to organizations and are scoped to one or more teams via role-based membership.

Content review clients do **not** need tx-agent-kit accounts. Content review happens via signed
URLs that render a read-only review page -- no client account required. Separately, the members
surface now supports **client collaborators**: account-backed invited users with
`membership_type = 'client'`, normally scoped to a workspace/team. These are for ongoing
collaboration inside the app, not the stateless review-link flow.

This spec covers subsystems **#1 Auth & Identity** and **#2 Org & Team Management**.

# Implementation Status

As of 2026-04-17, the launch-critical tenancy/auth implementation slice is in place and
the decomposed tx task graph for this design has been marked done. Implemented coverage
includes organization ownership (`organizations.owner_user_id`), disabled organization and
team memberships, roles/permissions/system role seeds, content review tokens, organization
and team member repository adapters, ownership transfer and last-admin guards, disabled
member authorization rejection, role CRUD with system-role immutability, content review
token creation/validation/revocation, team member API routes, organization member API
routes, role API routes, public review-token access, and integration tests for the
critical guard paths.

Remaining follow-up work is not part of the completed launch slice: plan-enforced hard
caps for teams/users, broader structural checks for tenant-scoped query coverage, and
downstream consumers that use review-token or brand context outside the tenancy boundary.

# Architecture

## Hierarchy

```
Organization (billing entity)
├── Team A (social accounts, content, media)
│   ├── User 1 (role: admin)
│   ├── User 2 (role: member)
│   └── User 3 (role: viewer, membership_type: client)
└── Team B
    └── ...
```

## Scale Targets

| Metric | Target | Current Limit | Notes |
|--------|--------|---------------|-------|
| Total users | 1,000 | No hard limit | Custom auth (tx-agent-kit) |
| Organizations | **500** | No hard limit | Planning assumption at 1K users (~2 users per org) |
| Teams per organization | **50 max** | No hard limit | Plan-enforced cap |
| Users per team | **50 max** | No hard limit | Plan-enforced cap |
| Concurrent active users | **TBD** | -- | Drives connection pool sizing |

## Isolation

All data access goes through the **API layer** (Drizzle ORM -> PostgreSQL). No client-side
database access. Authorization is enforced in application code, not database-level RLS.

- **API-level authorization**: Every route validates the authenticated user's org/team membership
  and permissions via middleware before querying the database
- **Drizzle ORM queries** always scope by `team_id` or `organization_id` -- no unscoped queries
- **No RLS**: Since there is no direct client -> database connection (no Supabase client SDK),
  row-level security is unnecessary. All access is mediated by the API.
- **Auth via tx-agent-kit**: JWT access tokens, refresh token rotation, session management,
  Google OAuth (OIDC), password auth with bcrypt, audit logging, rate limiting

## Team Authorization Middleware

Every team-scoped route must validate team membership in addition to org membership. A
`TeamAuthMiddleware` resolves the requesting user's `team_members` row for the target team
and binds it to the request context. If no row exists (or `disabled_at IS NOT NULL`), the
request is rejected with 403 regardless of org-level role.

This prevents a user who is an org-member but not a team-member from accessing another
team's resources by supplying an arbitrary `team_id` parameter.

## Ownership & Last-Admin Guards

- **Organization ownership**: `organizations.owner_user_id` designates the owner. Ownership
  transfer requires the current owner's explicit confirmation. The owner cannot be removed
  from `organization_members` without first transferring ownership.
- **Last-admin guard**: Removing or demoting an admin requires a pre-check that at least one
  other active admin exists. Self-demotion follows the same rule.
- **Self-removal guard**: A signed-in admin/owner cannot remove their own membership from the
  organization from the members UI or API. They must transfer ownership or have another admin
  remove them. Bulk removal skips the signed-in user and shows a specific notification rather
  than silently doing nothing.
- **Member deactivation**: `org_members.disabled_at` and `team_members.disabled_at` allow
  temporarily blocking access without deleting the membership row. Historical data attribution
  (who created what) is preserved. Authorization middleware rejects requests from disabled members.

## Invitations

Invitations are email-first and can be created before the invitee has an account. Admins create
an invitation with email, role, optional team/workspace scope, and membership type (`team` or
`client`). If the email already belongs to a user, `invitee_user_id` is stored immediately; if
not, it remains `NULL` and the invitation is discoverable later by a newly authenticated user
whose normalized email matches the invitation.

Accepting an invite:

1. Validates token, expiry, revocation, and pending status.
2. Verifies the authenticated principal matches either `invitee_user_id` or the invitation email.
3. Atomically marks the invitation accepted and binds `invitee_user_id` to the accepting user.
4. Creates the organization membership with the selected role and membership type.
5. Creates the team/workspace membership when `team_id` is present.

The Invite Member UI is a form: Enter submits when valid, Escape closes the dialog through the
shared Dialog primitive, and API error `message` fields are surfaced through `notify.apiError`
instead of being replaced with generic client-side text.

## Client Access Model -- Stateless Review

Review-link clients do **not** need tx-agent-kit accounts. Content review happens via signed URLs
that render a read-only review page. This remains separate from account-backed client
collaborators invited through member management.

Token scopes to the **entire team** -- the reviewer sees all content in `pending_approval` status
for that team. No per-item or per-campaign scoping. KISS.

**Flow:** Agency member generates a review link for a team -> signed URL with token -> reviewer
opens link -> sees all `pending_approval` content for that team -> can approve/reject/comment
(based on `permissions`) -> feedback stored in `content_approvals` with `approver_user_id = NULL`
and token reference.

# Data Model

## Core Tables

| Table | Purpose | Key Constraints |
|-------|---------|-----------------|
| `users` | Profile | One per authenticated user (custom auth via tx-agent-kit) |
| `organizations` | Billing, credits, subscription | Owns credit balance (BIGINT). `owner_user_id` (FK -> users), `usage_cap` |
| `teams` | Workspace container | FK -> organization. CASCADE delete |
| `organization_members` | Org membership | FK -> org, user, role. Type: `team` or `client`. `disabled_at` TIMESTAMPTZ for deactivation without deletion |
| `team_members` | Team membership | FK -> team, user, role. `disabled_at` TIMESTAMPTZ for deactivation without deletion |
| `roles` | Named roles | e.g., admin, member, viewer. `is_system` BOOLEAN (seeded roles are immutable) |
| `permissions` | Granular actions | `create_media`, `schedule_posts`, `manage_billing`, etc. |
| `role_permissions` | Many-to-many | Composite PK: (role_id, permission_id) |
| `invitations` | Sign-up invites | Token-based, expiry, normalized email, nullable `invitee_user_id`, FK -> org/team/role, `membership_type`, `revoked_at`, `revoked_by_user_id`, `team_id` (for direct-to-team invites) |
| `content_review_tokens` | Stateless content review | Signed URL tokens for read-only content review pages. No reviewer account required. |

## `content_review_tokens`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID | PK |
| `team_id` | UUID | FK -> teams (one team = one client for agencies) |
| `token` | TEXT | Unique, cryptographically random token |
| `expires_at` | TIMESTAMPTZ | Token expiry (default: 7 days) |
| `revoked_at` | TIMESTAMPTZ (nullable) | Manually revoked |
| `permissions` | TEXT[] | `['view', 'comment', 'approve', 'reject']` -- what the reviewer can do |
| `reviewer_name` | TEXT (nullable) | Display name for the reviewer |
| `reviewer_email` | TEXT (nullable) | For notification delivery |
| `last_accessed_at` | TIMESTAMPTZ (nullable) | Tracks when the link was last used |
| `created_by` | UUID | FK -> users (the agency member who created the link) |
| `created_at` | TIMESTAMPTZ | |

**Key constraints:** `UNIQUE(token)`, index on `(team_id)`

# Interfaces

```typescript
import { Context, type Option } from 'effect'
import type * as Effect from 'effect/Effect'
import type { ListParams, PaginatedResult } from '../../../pagination.js'

// ---------------------------------------------------------------------------
// Domain record types (representative -- actual fields mirror the data model)
// ---------------------------------------------------------------------------

type OrganizationMemberRecord = {
  readonly id: string
  readonly organizationId: string
  readonly userId: string
  readonly role: OrgMemberRole
  readonly membershipType: 'team' | 'client'
  readonly disabledAt: Date | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

type TeamMemberRecord = {
  readonly id: string
  readonly teamId: string
  readonly userId: string
  readonly role: TeamMemberRole
  readonly disabledAt: Date | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

type RoleRecord = {
  readonly id: string
  readonly name: string
  readonly isSystem: boolean
  readonly permissions: ReadonlyArray<string>
  readonly createdAt: Date
  readonly updatedAt: Date
}

type ContentReviewTokenRecord = {
  readonly id: string
  readonly teamId: string
  readonly token: string
  readonly expiresAt: Date
  readonly revokedAt: Date | null
  readonly permissions: ReadonlyArray<'view' | 'comment' | 'approve' | 'reject'>
  readonly reviewerName: string | null
  readonly reviewerEmail: string | null
  readonly lastAccessedAt: Date | null
  readonly createdBy: string
  readonly createdAt: Date
}

type OrgMemberRole = 'admin' | 'member' | 'viewer'
type TeamMemberRole = 'admin' | 'member' | 'viewer'

// ---------------------------------------------------------------------------
// Store Ports (persistence seams)
// All single-record return types use Effect's Option<T> instead of T | null.
// ---------------------------------------------------------------------------

export class OrganizationMemberStorePort extends Context.Tag('OrganizationMemberStorePort')<
  OrganizationMemberStorePort,
  {
    list: (organizationId: string, params: ListParams) => Effect.Effect<PaginatedResult<OrganizationMemberRecord>, unknown>
    getById: (id: string) => Effect.Effect<Option.Option<OrganizationMemberRecord>, unknown>
    getByOrgAndUser: (organizationId: string, userId: string) => Effect.Effect<Option.Option<OrganizationMemberRecord>, unknown>
    create: (input: {
      organizationId: string
      userId: string
      role: OrgMemberRole
      membershipType: 'team' | 'client'
    }) => Effect.Effect<Option.Option<OrganizationMemberRecord>, unknown>
    updateRole: (id: string, role: OrgMemberRole) => Effect.Effect<Option.Option<OrganizationMemberRecord>, unknown>
    disable: (id: string) => Effect.Effect<Option.Option<OrganizationMemberRecord>, unknown>
    enable: (id: string) => Effect.Effect<Option.Option<OrganizationMemberRecord>, unknown>
    remove: (id: string) => Effect.Effect<{ deleted: true }, unknown>
    countActiveAdmins: (organizationId: string) => Effect.Effect<number, unknown>
  }
>() {}

export class TeamMemberStorePort extends Context.Tag('TeamMemberStorePort')<
  TeamMemberStorePort,
  {
    list: (teamId: string, params: ListParams) => Effect.Effect<PaginatedResult<TeamMemberRecord>, unknown>
    getById: (id: string) => Effect.Effect<Option.Option<TeamMemberRecord>, unknown>
    getByTeamAndUser: (teamId: string, userId: string) => Effect.Effect<Option.Option<TeamMemberRecord>, unknown>
    create: (input: {
      teamId: string
      userId: string
      role: TeamMemberRole
    }) => Effect.Effect<Option.Option<TeamMemberRecord>, unknown>
    updateRole: (id: string, role: TeamMemberRole) => Effect.Effect<Option.Option<TeamMemberRecord>, unknown>
    disable: (id: string) => Effect.Effect<Option.Option<TeamMemberRecord>, unknown>
    enable: (id: string) => Effect.Effect<Option.Option<TeamMemberRecord>, unknown>
    remove: (id: string) => Effect.Effect<{ deleted: true }, unknown>
  }
>() {}

export class OrganizationOwnershipPort extends Context.Tag('OrganizationOwnershipPort')<
  OrganizationOwnershipPort,
  {
    getOwnerUserId: (organizationId: string) => Effect.Effect<Option.Option<string>, unknown>
    transferOwnership: (input: {
      organizationId: string
      fromUserId: string
      toUserId: string
    }) => Effect.Effect<{ transferred: true }, unknown>
  }
>() {}

export class ContentReviewTokenStorePort extends Context.Tag('ContentReviewTokenStorePort')<
  ContentReviewTokenStorePort,
  {
    list: (teamId: string, params: ListParams) => Effect.Effect<PaginatedResult<ContentReviewTokenRecord>, unknown>
    getById: (id: string) => Effect.Effect<Option.Option<ContentReviewTokenRecord>, unknown>
    findByToken: (token: string) => Effect.Effect<Option.Option<ContentReviewTokenRecord>, unknown>
    create: (input: {
      teamId: string
      permissions: ReadonlyArray<'view' | 'comment' | 'approve' | 'reject'>
      reviewerName: string | null
      reviewerEmail: string | null
      expiresAt: Date
      createdBy: string
    }) => Effect.Effect<Option.Option<ContentReviewTokenRecord>, unknown>
    revoke: (id: string) => Effect.Effect<Option.Option<ContentReviewTokenRecord>, unknown>
    touchLastAccessed: (id: string) => Effect.Effect<Option.Option<ContentReviewTokenRecord>, unknown>
  }
>() {}

export class RoleStorePort extends Context.Tag('RoleStorePort')<
  RoleStorePort,
  {
    list: (params: ListParams) => Effect.Effect<PaginatedResult<RoleRecord>, unknown>
    getById: (id: string) => Effect.Effect<Option.Option<RoleRecord>, unknown>
    getByName: (name: string) => Effect.Effect<Option.Option<RoleRecord>, unknown>
    create: (input: {
      name: string
      permissions: ReadonlyArray<string>
    }) => Effect.Effect<Option.Option<RoleRecord>, unknown>
    update: (input: {
      id: string
      name?: string
      permissions?: ReadonlyArray<string>
    }) => Effect.Effect<Option.Option<RoleRecord>, unknown>
    remove: (id: string) => Effect.Effect<{ deleted: true }, unknown>
  }
>() {}

// ---------------------------------------------------------------------------
// Application Services
// ---------------------------------------------------------------------------

export class TeamAuthorizationService extends Context.Tag('TeamAuthorizationService')<
  TeamAuthorizationService,
  {
    /** Resolve the requesting user's team membership. Returns Option.none() if not a member or disabled. */
    resolveTeamMembership: (teamId: string, userId: string) => Effect.Effect<Option.Option<TeamMemberRecord>, unknown>
    /** Check whether a user has a specific permission within a team. */
    hasPermission: (teamId: string, userId: string, permission: string) => Effect.Effect<boolean, unknown>
  }
>() {}

export class OrganizationMemberService extends Context.Tag('OrganizationMemberService')<
  OrganizationMemberService,
  {
    addMember: (input: {
      organizationId: string
      userId: string
      role: OrgMemberRole
      membershipType: 'team' | 'client'
    }) => Effect.Effect<OrganizationMemberRecord, unknown>
    removeMember: (organizationId: string, memberId: string) => Effect.Effect<{ deleted: true }, unknown>
    updateRole: (organizationId: string, memberId: string, role: OrgMemberRole) => Effect.Effect<OrganizationMemberRecord, unknown>
    disableMember: (organizationId: string, memberId: string) => Effect.Effect<OrganizationMemberRecord, unknown>
    enableMember: (organizationId: string, memberId: string) => Effect.Effect<OrganizationMemberRecord, unknown>
    transferOwnership: (organizationId: string, fromUserId: string, toUserId: string) => Effect.Effect<{ transferred: true }, unknown>
  }
>() {}

export class ContentReviewTokenService extends Context.Tag('ContentReviewTokenService')<
  ContentReviewTokenService,
  {
    /** Generate a review token (signed URL) for a team. */
    createToken: (input: {
      teamId: string
      permissions: ReadonlyArray<'view' | 'comment' | 'approve' | 'reject'>
      reviewerName: string | null
      reviewerEmail: string | null
      expiresInDays?: number
      createdBy: string
    }) => Effect.Effect<ContentReviewTokenRecord, unknown>
    /** Validate a token: checks expiry, revocation, and returns the record if valid. */
    validateToken: (token: string) => Effect.Effect<Option.Option<ContentReviewTokenRecord>, unknown>
    revokeToken: (id: string) => Effect.Effect<ContentReviewTokenRecord, unknown>
  }
>() {}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * TeamAuthMiddleware resolves the requesting user's team_members row for the
 * target team and binds it to the request context. If no row exists (or
 * disabled_at IS NOT NULL), the request is rejected with 403.
 *
 * Applied to all team-scoped routes before the handler runs.
 */
export class TeamAuthMiddleware extends Context.Tag('TeamAuthMiddleware')<
  TeamAuthMiddleware,
  {
    /** Extract teamId from route params, resolve membership, bind to context or reject 403. */
    guard: (request: {
      teamId: string
      userId: string
    }) => Effect.Effect<TeamMemberRecord, unknown>
  }
>() {}

// ---------------------------------------------------------------------------
// API Routes
// ---------------------------------------------------------------------------

/*
  Organization Members
    GET    /organizations/:orgId/members              -> list members (paginated)
    POST   /organizations/:orgId/members              -> add member
    PATCH  /organizations/:orgId/members/:memberId    -> update role
    DELETE /organizations/:orgId/members/:memberId    -> remove member
    POST   /organizations/:orgId/members/:memberId/disable  -> disable member
    POST   /organizations/:orgId/members/:memberId/enable   -> enable member
    POST   /organizations/:orgId/transfer-ownership   -> transfer org ownership

  Team Members
    GET    /teams/:teamId/members                     -> list members (paginated)
    POST   /teams/:teamId/members                     -> add member
    PATCH  /teams/:teamId/members/:memberId           -> update role
    DELETE /teams/:teamId/members/:memberId           -> remove member
    POST   /teams/:teamId/members/:memberId/disable   -> disable member
    POST   /teams/:teamId/members/:memberId/enable    -> enable member

  Roles
    GET    /roles                                     -> list roles (paginated)
    POST   /roles                                     -> create custom role
    PATCH  /roles/:roleId                             -> update custom role
    DELETE /roles/:roleId                             -> delete custom role (system roles rejected)

  Content Review Tokens
    GET    /teams/:teamId/review-tokens               -> list tokens (paginated)
    POST   /teams/:teamId/review-tokens               -> create review token
    DELETE /teams/:teamId/review-tokens/:tokenId      -> revoke token
    GET    /review/:token                             -> public: validate token & return review page data
*/
```

# Invariants

```yaml
invariants:
  - id: INV-TEN-001
    statement: >
      At least one active admin must exist per organization at all times. Removing
      or demoting an admin requires a pre-check that at least one other active admin
      exists. Self-demotion follows the same rule.
    severity: critical
    verified_by:
      - REQ-TEN-001

  - id: INV-TEN-002
    statement: >
      The organization owner (organizations.owner_user_id) cannot be removed from
      organization_members without first transferring ownership to another active admin.
    severity: critical
    verified_by:
      - REQ-TEN-002

  - id: INV-TEN-003
    statement: >
      Team auth middleware must reject requests from members whose disabled_at is
      NOT NULL with a 403 response, regardless of org-level role.
    severity: critical
    verified_by:
      - REQ-TEN-003

  - id: INV-TEN-004
    statement: >
      All data queries must scope by team_id or organization_id. No unscoped queries
      are permitted. Drizzle ORM queries always include the tenant scope filter.
    severity: critical
    verified_by:
      - REQ-TEN-004

  - id: INV-TEN-005
    statement: >
      A user who is an org-member but not a team-member must NOT be able to access
      that team's resources. TeamAuthMiddleware resolves the requesting user's
      team_members row for the target team; if no row exists, the request is
      rejected with 403.
    severity: critical
    verified_by:
      - REQ-TEN-005

  - id: INV-TEN-006
    statement: >
      content_review_tokens.token must be cryptographically random (e.g., via
      crypto.randomBytes or equivalent). Tokens must be unique (enforced by
      UNIQUE constraint on the token column).
    severity: high
    verified_by:
      - REQ-TEN-006

  - id: INV-TEN-007
    statement: >
      Content review tokens must have an expires_at value (default 7 days). Expired
      or revoked tokens (revoked_at IS NOT NULL) must be rejected at access time.
    severity: high
    verified_by:
      - REQ-TEN-007

  - id: INV-TEN-008
    statement: >
      Seeded system roles (roles.is_system = true) must not be modified or deleted
      by any user action. Only non-system custom roles may be created, edited, or
      removed.
    severity: high
    verified_by:
      - REQ-TEN-008

  - id: INV-TEN-009
    statement: >
      Invitation tokens must have an expiry timestamp. Expired or revoked invitations
      (revoked_at IS NOT NULL) must not grant access or create memberships.
    severity: high
    verified_by:
      - REQ-TEN-009

  - id: INV-TEN-009A
    statement: >
      Invite-before-signup must be email-safe. A pending invitation with NULL
      invitee_user_id may only be listed or accepted by an authenticated user
      whose normalized email matches the invitation email. Accepting the token
      binds invitee_user_id to that user in the same transaction that creates
      memberships.
    severity: critical
    verified_by:
      - REQ-TEN-009

  - id: INV-TEN-010
    statement: >
      Deleting an organization must CASCADE delete all teams under it, along with
      associated team_members, content, and media (per the FK CASCADE constraint).
    severity: high
    verified_by:
      - REQ-TEN-010
```

# Failure Modes

```yaml
failure_modes:
  - condition: "Last active admin attempts self-demotion or removal."
    impact: >
      Organization would be left with no admin, making it impossible to manage
      membership, billing, or settings.
    handling: >
      Pre-check counts active admins (excluding the requesting user). If count < 1,
      reject with a 409 Conflict and message explaining another admin must be
      promoted first.

  - condition: "Invitation token expires after recipient clicks link but before signup completes."
    impact: >
      User sees an error mid-signup flow. If partial state was created (e.g., a user
      row), it becomes orphaned without an org/team membership.
    handling: >
      Token expiry is checked at the start of the accept-invitation flow, not just
      at link click. Membership creation and user creation (if new) happen in a
      single database transaction. If the token is expired, the transaction rolls
      back and the user is prompted to request a new invitation.

  - condition: "Ownership transfer fails partway (e.g., DB error after clearing old owner but before setting new owner)."
    impact: >
      Organization left with no owner or with an inconsistent owner_user_id.
    handling: >
      Ownership transfer must be performed in a single database transaction:
      (1) verify target user is an active admin, (2) update organizations.owner_user_id.
      If any step fails, the transaction rolls back and the original owner remains.

  - condition: "Review token link shared publicly or forwarded to unauthorized party."
    impact: >
      Unauthorized person can view and potentially approve/reject content for the team.
    handling: >
      Tokens are scoped to a single team and expire after 7 days (configurable).
      Tokens can be manually revoked (revoked_at). last_accessed_at column allows
      auditing usage. Agency members can regenerate tokens at any time, invalidating
      the old one.

  - condition: "User disabled (disabled_at set) while they have active sessions/JWTs."
    impact: >
      Disabled user could continue making requests until their JWT expires.
    handling: >
      TeamAuthMiddleware checks disabled_at on every request, not just at login.
      Even with a valid JWT, a disabled member is rejected with 403. Short JWT
      expiry (15 min access tokens) limits the window.
```

# Verification

```yaml
verification:
  - requirement_id: REQ-TEN-001
    test_type: unit
    target: >
      Unit test the admin-demotion/removal use case: verify that demoting or
      removing the last admin raises an error and does not modify the database.
      Test with 1 admin (should fail) and 2 admins (should succeed for one).

  - requirement_id: REQ-TEN-002
    test_type: unit
    target: >
      Unit test ownership transfer: verify owner cannot be removed from
      organization_members without transferring ownership first. Verify transfer
      fails if target is not an active admin.

  - requirement_id: REQ-TEN-003
    test_type: integration
    target: >
      Integration test: make an authenticated API request as a user whose
      disabled_at is set. Verify the response is 403. Repeat for both org-level
      and team-level disabled_at.

  - requirement_id: REQ-TEN-004
    test_type: unit
    target: >
      Static analysis or code review lint rule: verify all Drizzle query builders
      in the codebase include a team_id or organization_id filter. Structural
      lint script (enforce-tenant-scope) should catch unscoped queries.

  - requirement_id: REQ-TEN-005
    test_type: integration
    target: >
      Integration test: authenticate as a user who is an org member but NOT a
      team member. Make a request to a team-scoped endpoint. Verify 403 response.

  - requirement_id: REQ-TEN-006
    test_type: unit
    target: >
      Unit test token generation: verify tokens are generated via a
      cryptographically secure source (e.g., crypto.randomBytes). Verify UNIQUE
      constraint on token column via a DB-level test (pgTAP).

  - requirement_id: REQ-TEN-007
    test_type: integration
    target: >
      Integration test: create a review token, advance time past expires_at,
      attempt to use the token. Verify it is rejected. Repeat with a revoked
      token (revoked_at set).

  - requirement_id: REQ-TEN-008
    test_type: integration
    target: >
      Integration test: attempt to update or delete a role where is_system = true.
      Verify the operation is rejected with an appropriate error.

  - requirement_id: REQ-TEN-009
    test_type: integration
    target: >
      Integration test: create an invitation, advance time past expiry, attempt
      to accept. Verify it fails and no membership is created. Repeat with a
      revoked invitation.

  - requirement_id: REQ-TEN-009
    test_type: integration
    target: >
      Integration test: create an invitation for an email with no existing user.
      Verify invitee_user_id is NULL, then create/sign in a user with that email,
      list the user's invitations, accept the token, and verify membership is
      created with the invited role, membership_type, and optional team scope.

  - requirement_id: REQ-TEN-010
    test_type: integration
    target: >
      Integration test: create an organization with teams, members, and content.
      Delete the organization. Verify all teams, team_members, and associated
      data are cascade-deleted.
```

# Open Questions

- Concurrent active user target TBD — drives connection pool sizing.
- Plan-enforced caps for teams-per-org and users-per-team need final values per plan tier.
- ~~`client_id` FK on `social_accounts`~~ **Resolved** — dropped `clients` table. One team = one client. `team_id` IS the client scope.
