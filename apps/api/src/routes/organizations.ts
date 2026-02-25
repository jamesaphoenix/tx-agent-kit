import { HttpApiBuilder, HttpServerRequest } from '@effect/platform'
import { principalFromAuthorization, OrganizationService } from '@tx-agent-kit/core'
import {
  type InvitationStatus,
  type OrganizationOnboardingData,
  type OrgMemberRole,
  type SubscriptionStatus
} from '@tx-agent-kit/contracts'
import { Effect } from 'effect'
import { BadRequest, TxAgentApi, mapCoreError } from '../api.js'
import { parseListQuery } from './list-query.js'

export const OrganizationsRouteKind = 'crud' as const

const toApiOrganization = (organization: {
  id: string
  name: string
  billingEmail: string | null
  onboardingData: OrganizationOnboardingData | null
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  stripePaymentMethodId: string | null
  creditsBalance: number
  reservedCredits: number
  autoRechargeEnabled: boolean
  autoRechargeThreshold: number | null
  autoRechargeAmount: number | null
  isSubscribed: boolean
  subscriptionStatus: SubscriptionStatus
  subscriptionPlan: string | null
  subscriptionStartedAt: Date | null
  subscriptionEndsAt: Date | null
  subscriptionCurrentPeriodEnd: Date | null
  createdAt: Date
  updatedAt: Date
}) => ({
  id: organization.id,
  name: organization.name,
  billingEmail: organization.billingEmail,
  onboardingData: organization.onboardingData,
  stripeCustomerId: organization.stripeCustomerId,
  stripeSubscriptionId: organization.stripeSubscriptionId,
  stripePaymentMethodId: organization.stripePaymentMethodId,
  creditsBalance: organization.creditsBalance,
  reservedCredits: organization.reservedCredits,
  autoRechargeEnabled: organization.autoRechargeEnabled,
  autoRechargeThreshold: organization.autoRechargeThreshold,
  autoRechargeAmount: organization.autoRechargeAmount,
  isSubscribed: organization.isSubscribed,
  subscriptionStatus: organization.subscriptionStatus,
  subscriptionPlan: organization.subscriptionPlan,
  subscriptionStartedAt: organization.subscriptionStartedAt?.toISOString() ?? null,
  subscriptionEndsAt: organization.subscriptionEndsAt?.toISOString() ?? null,
  subscriptionCurrentPeriodEnd: organization.subscriptionCurrentPeriodEnd?.toISOString() ?? null,
  createdAt: organization.createdAt.toISOString(),
  updatedAt: organization.updatedAt.toISOString()
})

const toApiInvitation = (invitation: {
  id: string
  organizationId: string
  email: string
  role: OrgMemberRole
  status: InvitationStatus
  invitedByUserId: string
  token: string
  expiresAt: Date
  createdAt: Date
}) => ({
  id: invitation.id,
  organizationId: invitation.organizationId,
  email: invitation.email,
  role: invitation.role === 'owner' ? 'admin' as const : invitation.role,
  status: invitation.status,
  invitedByUserId: invitation.invitedByUserId,
  token: invitation.token,
  expiresAt: invitation.expiresAt.toISOString(),
  createdAt: invitation.createdAt.toISOString()
})

export const OrganizationsLive = HttpApiBuilder.group(TxAgentApi, 'organizations', (handlers) =>
  handlers
    .handle('listOrganizations', ({ urlParams }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const principal = yield* principalFromAuthorization(request.headers.authorization).pipe(Effect.mapError(mapCoreError))
        const service = yield* OrganizationService

        const parsed = parseListQuery(urlParams, {
          defaultSortBy: 'createdAt',
          allowedSortBy: ['createdAt', 'name'],
          allowedFilterKeys: []
        })

        if (!parsed.ok) {
          return yield* Effect.fail(new BadRequest({ message: parsed.message }))
        }

        const page = yield* service.listForUser(principal.userId, parsed.value).pipe(Effect.mapError(mapCoreError))
        return {
          data: page.data.map(toApiOrganization),
          total: page.total,
          nextCursor: page.nextCursor,
          prevCursor: page.prevCursor
        }
      })
    )
    .handle('getOrganization', ({ path }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const principal = yield* principalFromAuthorization(request.headers.authorization).pipe(Effect.mapError(mapCoreError))
        const service = yield* OrganizationService
        const organization = yield* service.getById(principal, path.organizationId).pipe(Effect.mapError(mapCoreError))
        return toApiOrganization(organization)
      })
    )
    .handle('getManyOrganizations', ({ payload }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const principal = yield* principalFromAuthorization(request.headers.authorization).pipe(Effect.mapError(mapCoreError))
        const service = yield* OrganizationService
        const organizations = yield* service.getManyByIds(principal, payload.ids).pipe(Effect.mapError(mapCoreError))

        return {
          data: organizations.map(toApiOrganization)
        }
      })
    )
    .handle('createOrganization', ({ payload }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const principal = yield* principalFromAuthorization(request.headers.authorization).pipe(Effect.mapError(mapCoreError))
        const service = yield* OrganizationService
        const organization = yield* service.createForUser(principal.userId, payload).pipe(Effect.mapError(mapCoreError))
        return toApiOrganization(organization)
      })
    )
    .handle('updateOrganization', ({ path, payload }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const principal = yield* principalFromAuthorization(request.headers.authorization).pipe(Effect.mapError(mapCoreError))
        const service = yield* OrganizationService
        const organization = yield* service.updateById(principal, path.organizationId, payload).pipe(Effect.mapError(mapCoreError))
        return toApiOrganization(organization)
      })
    )
    .handle('removeOrganization', ({ path }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const principal = yield* principalFromAuthorization(request.headers.authorization).pipe(Effect.mapError(mapCoreError))
        const service = yield* OrganizationService
        return yield* service.removeById(principal, path.organizationId).pipe(Effect.mapError(mapCoreError))
      })
    )
    .handle('listInvitations', ({ urlParams }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const principal = yield* principalFromAuthorization(request.headers.authorization).pipe(Effect.mapError(mapCoreError))
        const service = yield* OrganizationService

        const parsed = parseListQuery(urlParams, {
          defaultSortBy: 'createdAt',
          allowedSortBy: ['createdAt', 'expiresAt'],
          allowedFilterKeys: ['status', 'role']
        })

        if (!parsed.ok) {
          return yield* Effect.fail(new BadRequest({ message: parsed.message }))
        }

        const page = yield* service.listInvitationsForUser(principal.userId, parsed.value).pipe(Effect.mapError(mapCoreError))
        return {
          data: page.data.map(toApiInvitation),
          total: page.total,
          nextCursor: page.nextCursor,
          prevCursor: page.prevCursor
        }
      })
    )
    .handle('getInvitation', ({ path }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const principal = yield* principalFromAuthorization(request.headers.authorization).pipe(Effect.mapError(mapCoreError))
        const service = yield* OrganizationService
        const invitation = yield* service.getInvitationById(principal, path.invitationId).pipe(Effect.mapError(mapCoreError))
        return toApiInvitation(invitation)
      })
    )
    .handle('getManyInvitations', ({ payload }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const principal = yield* principalFromAuthorization(request.headers.authorization).pipe(Effect.mapError(mapCoreError))
        const service = yield* OrganizationService
        const invitations = yield* service.getManyInvitationsByIds(principal, payload.ids).pipe(Effect.mapError(mapCoreError))

        return {
          data: invitations.map(toApiInvitation)
        }
      })
    )
    .handle('createInvitation', ({ payload }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const principal = yield* principalFromAuthorization(request.headers.authorization).pipe(Effect.mapError(mapCoreError))
        const service = yield* OrganizationService
        const invitation = yield* service.createInvitation(principal, payload).pipe(Effect.mapError(mapCoreError))
        return toApiInvitation(invitation)
      })
    )
    .handle('updateInvitation', ({ path, payload }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const principal = yield* principalFromAuthorization(request.headers.authorization).pipe(Effect.mapError(mapCoreError))
        const service = yield* OrganizationService
        const invitation = yield* service.updateInvitationById(principal, path.invitationId, payload).pipe(Effect.mapError(mapCoreError))
        return toApiInvitation(invitation)
      })
    )
    .handle('removeInvitation', ({ path }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const principal = yield* principalFromAuthorization(request.headers.authorization).pipe(Effect.mapError(mapCoreError))
        const service = yield* OrganizationService
        return yield* service.removeInvitationById(principal, path.invitationId).pipe(Effect.mapError(mapCoreError))
      })
    )
    .handle('acceptInvitation', ({ path }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const principal = yield* principalFromAuthorization(request.headers.authorization).pipe(Effect.mapError(mapCoreError))
        const service = yield* OrganizationService
        return yield* service.acceptInvitation(principal, path.token).pipe(Effect.mapError(mapCoreError))
      })
    )
)
