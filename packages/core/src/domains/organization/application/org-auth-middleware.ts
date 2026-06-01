import { Context, Effect, Layer, Option } from 'effect'
import { internalError, unauthorized, type CoreError } from '../../../errors.js'
import { OrganizationStorePort } from '../ports/organization-ports.js'

const toCoreInternal = (message: string) => (cause: unknown): CoreError =>
  internalError(message, cause)

import type { MemberRole } from '@tx-agent-kit/contracts'

export interface OrgMemberContext {
  readonly organizationId: string
  readonly userId: string
  readonly role: MemberRole
}

export class OrgAuthMiddleware extends Context.Tag('OrgAuthMiddleware')<
  OrgAuthMiddleware,
  {
    resolveOrgMember: (
      organizationId: string,
      userId: string
    ) => Effect.Effect<OrgMemberContext, CoreError, OrganizationStorePort>
  }
>() {}

export const OrgAuthMiddlewareLive = Layer.effect(
  OrgAuthMiddleware,
  Effect.succeed({
    resolveOrgMember: (organizationId, userId) =>
      Effect.gen(function* () {
        const orgStore = yield* OrganizationStorePort

        const isMember = yield* orgStore.isMember(organizationId, userId).pipe(
          Effect.mapError(toCoreInternal('Failed to verify organization membership'))
        )

        if (!isMember) {
          return yield* Effect.fail(unauthorized('Not a member of this organization'))
        }

        const role = yield* orgStore.getMemberRole(organizationId, userId).pipe(
          Effect.mapError(toCoreInternal('Failed to resolve organization role')),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(unauthorized('Not a member of this organization')),
            onSome: Effect.succeed
          }))
        )

        return { organizationId, userId, role }
      })
  })
)
