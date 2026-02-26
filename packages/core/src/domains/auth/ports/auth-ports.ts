import { Context } from 'effect'
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
    create: (input: { email: string; passwordHash: string; name: string }) => Effect.Effect<AuthUserRecord | null, unknown>
    findByEmail: (email: string) => Effect.Effect<AuthUserRecord | null, unknown>
    findById: (id: string) => Effect.Effect<AuthUserRecord | null, unknown>
    updatePasswordHash: (id: string, passwordHash: string) => Effect.Effect<AuthUserRecord | null, unknown>
    deleteById: (id: string) => Effect.Effect<AuthUserRecord | null, unknown>
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
    ) => Effect.Effect<{ organizationId: string; role: OrgMemberRole; permissions: ReadonlyArray<PermissionAction> } | null, unknown>
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
    }) => Effect.Effect<{ sessionId: string; expiresAt: Date } | null, unknown>
    findActiveById: (sessionId: string) => Effect.Effect<{ sessionId: string; userId: string; expiresAt: Date } | null, unknown>
    touchById: (sessionId: string) => Effect.Effect<void, unknown>
    revokeById: (sessionId: string) => Effect.Effect<number, unknown>
    revokeAllForUser: (userId: string) => Effect.Effect<number, unknown>
  }
>() {}

export class AuthLoginRefreshTokenPort extends Context.Tag('AuthLoginRefreshTokenPort')<
  AuthLoginRefreshTokenPort,
  {
    issueForSession: (sessionId: string) => Effect.Effect<{ refreshToken: string; expiresAt: Date }, unknown>
    rotate: (refreshToken: string) => Effect.Effect<{ sessionId: string; refreshToken: string; expiresAt: Date } | null, unknown>
    revokeForSession: (sessionId: string) => Effect.Effect<void, unknown>
  }
>() {}

export class PasswordResetTokenPort extends Context.Tag('PasswordResetTokenPort')<
  PasswordResetTokenPort,
  {
    createToken: (userId: string) => Effect.Effect<string, unknown>
    consumeToken: (token: string) => Effect.Effect<{ userId: string } | null, unknown>
    revokeTokensForUser: (userId: string) => Effect.Effect<void, unknown>
  }
>() {}

export class GoogleOidcPort extends Context.Tag('GoogleOidcPort')<
  GoogleOidcPort,
  {
    startAuthorization: (input: { ipAddress: string | null }) => Effect.Effect<GoogleAuthStartResult, unknown>
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
    }) => Effect.Effect<{ userId: string; provider: 'password' | 'google'; providerSubject: string; email: string } | null, unknown>
    findByUserProvider: (input: {
      userId: string
      provider: 'password' | 'google'
    }) => Effect.Effect<{ userId: string; provider: 'password' | 'google'; providerSubject: string; email: string } | null, unknown>
    linkIdentity: (input: {
      userId: string
      provider: 'password' | 'google'
      providerSubject: string
      email: string
      emailVerified: boolean
    }) => Effect.Effect<{ userId: string; provider: 'password' | 'google'; providerSubject: string; email: string } | null, unknown>
    unlinkIdentity: (input: {
      userId: string
      provider: 'password' | 'google'
    }) => Effect.Effect<{ userId: string; provider: 'password' | 'google'; providerSubject: string; email: string } | null, unknown>
  }
>() {}

export class AuthLoginAuditPort extends Context.Tag('AuthLoginAuditPort')<
  AuthLoginAuditPort,
  {
    record: (input: {
      userId: string | null
      eventType: 'login_success' | 'login_failure' | 'password_reset_requested' | 'password_changed' | 'oauth_linked' | 'oauth_unlinked' | 'session_refreshed' | 'session_revoked'
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
