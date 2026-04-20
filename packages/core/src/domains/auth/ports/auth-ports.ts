import { Context, type Option } from 'effect'
import type * as Effect from 'effect/Effect'
import type { OrgMemberRole, PermissionAction } from '@tx-agent-kit/contracts'
import type {
  AuthSessionTokenPayload,
  GoogleAuthStartResult,
  AuthUserRecord
} from '../domain/auth-domain.js'

export const AuthRepositoryKind = 'custom' as const

export type { AuthSessionTokenPayload, AuthUserRecord }

export class AuthUsersPort extends Context.Tag('AuthUsersPort')<
  AuthUsersPort,
  {
    create: (input: { email: string; passwordHash: string; name: string }) => Effect.Effect<Option.Option<AuthUserRecord>, unknown>
    findByEmail: (email: string) => Effect.Effect<Option.Option<AuthUserRecord>, unknown>
    findById: (id: string) => Effect.Effect<Option.Option<AuthUserRecord>, unknown>
    updatePasswordHash: (id: string, passwordHash: string) => Effect.Effect<Option.Option<AuthUserRecord>, unknown>
    deleteById: (id: string) => Effect.Effect<Option.Option<AuthUserRecord>, unknown>
  }
>() {}

export class AuthOrganizationOwnershipPort extends Context.Tag('AuthOrganizationOwnershipPort')<
  AuthOrganizationOwnershipPort,
  {
    countOwnedByUser: (userId: string) => Effect.Effect<number, unknown>
  }
>() {}

export class AuthOrganizationMembershipPort extends Context.Tag('AuthOrganizationMembershipPort')<
  AuthOrganizationMembershipPort,
  {
    getPrimaryMembershipForUser: (
      userId: string
    ) => Effect.Effect<Option.Option<{ organizationId: string; role: OrgMemberRole; permissions: ReadonlyArray<PermissionAction> }>, unknown>
  }
>() {}

export class PasswordHasherPort extends Context.Tag('PasswordHasherPort')<
  PasswordHasherPort,
  {
    hash: (plainText: string) => Effect.Effect<string, unknown>
    verify: (plainText: string, hash: string) => Effect.Effect<boolean, unknown>
  }
>() {}

export class SessionTokenPort extends Context.Tag('SessionTokenPort')<
  SessionTokenPort,
  {
    sign: (payload: Pick<AuthSessionTokenPayload, 'sub' | 'email' | 'pwd' | 'sid'>) => Effect.Effect<string, unknown>
    verify: (token: string) => Effect.Effect<AuthSessionTokenPayload, unknown>
  }
>() {}

export class AuthLoginSessionPort extends Context.Tag('AuthLoginSessionPort')<
  AuthLoginSessionPort,
  {
    create: (input: {
      userId: string
      provider: 'password' | 'google'
      createdIp: string | null
      createdUserAgent: string | null
    }) => Effect.Effect<Option.Option<{ sessionId: string; expiresAt: Date }>, unknown>
    findActiveById: (sessionId: string) => Effect.Effect<Option.Option<{ sessionId: string; userId: string; expiresAt: Date }>, unknown>
    touchById: (sessionId: string) => Effect.Effect<void, unknown>
    revokeById: (sessionId: string) => Effect.Effect<number, unknown>
    revokeAllForUser: (userId: string) => Effect.Effect<number, unknown>
  }
>() {}

export class AuthLoginRefreshTokenPort extends Context.Tag('AuthLoginRefreshTokenPort')<
  AuthLoginRefreshTokenPort,
  {
    issueForSession: (sessionId: string) => Effect.Effect<{ refreshToken: string; expiresAt: Date }, unknown>
    rotate: (refreshToken: string) => Effect.Effect<Option.Option<{ sessionId: string; refreshToken: string; expiresAt: Date }>, unknown>
    revokeForSession: (sessionId: string) => Effect.Effect<void, unknown>
    revokeAllForUser: (userId: string) => Effect.Effect<void, unknown>
  }
>() {}

export class PasswordResetTokenPort extends Context.Tag('PasswordResetTokenPort')<
  PasswordResetTokenPort,
  {
    createToken: (userId: string) => Effect.Effect<string, unknown>
    consumeToken: (token: string) => Effect.Effect<Option.Option<{ userId: string }>, unknown>
    revokeTokensForUser: (userId: string) => Effect.Effect<void, unknown>
  }
>() {}

export class GoogleOidcPort extends Context.Tag('GoogleOidcPort')<
  GoogleOidcPort,
  {
    startAuthorization: (input: {
      ipAddress: string | null
      statePrefix?: string
    }) => Effect.Effect<GoogleAuthStartResult, unknown>
    completeAuthorization: (input: {
      code: string
      state: string
    }) => Effect.Effect<{
      provider: 'google'
      providerSubject: string
      email: string
      emailVerified: boolean
      name: string
    }, unknown>
  }
>() {}

export class AuthLoginIdentityPort extends Context.Tag('AuthLoginIdentityPort')<
  AuthLoginIdentityPort,
  {
    findByProviderSubject: (input: {
      provider: 'password' | 'google'
      providerSubject: string
    }) => Effect.Effect<Option.Option<{ userId: string; provider: 'password' | 'google'; providerSubject: string; email: string }>, unknown>
    findByUserProvider: (input: {
      userId: string
      provider: 'password' | 'google'
    }) => Effect.Effect<Option.Option<{ userId: string; provider: 'password' | 'google'; providerSubject: string; email: string }>, unknown>
    linkIdentity: (input: {
      userId: string
      provider: 'password' | 'google'
      providerSubject: string
      email: string
      emailVerified: boolean
    }) => Effect.Effect<Option.Option<{ userId: string; provider: 'password' | 'google'; providerSubject: string; email: string }>, unknown>
    unlinkIdentity: (input: {
      userId: string
      provider: 'password' | 'google'
    }) => Effect.Effect<Option.Option<{ userId: string; provider: 'password' | 'google'; providerSubject: string; email: string }>, unknown>
  }
>() {}

export class AuthLoginAuditPort extends Context.Tag('AuthLoginAuditPort')<
  AuthLoginAuditPort,
  {
    record: (input: {
      userId: string | null
      eventType: 'login_success' | 'login_failure' | 'password_reset_requested' | 'password_changed' | 'oauth_linked' | 'oauth_unlinked' | 'session_refreshed' | 'session_revoked' | 'account_deleted'
      status: 'success' | 'failure'
      identifier: string | null
      ipAddress: string | null
      metadata: Record<string, unknown>
    }) => Effect.Effect<void, unknown>
  }
>() {}

export class PasswordResetEmailPort extends Context.Tag('PasswordResetEmailPort')<
  PasswordResetEmailPort,
  {
    sendPasswordResetEmail: (input: {
      email: string
      name: string
      token: string
    }) => Effect.Effect<void, unknown>
  }
>() {}
