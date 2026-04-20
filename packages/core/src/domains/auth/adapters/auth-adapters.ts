import { createHash, randomBytes } from 'node:crypto'
import { hashPassword, signSessionToken, verifyPassword, verifySessionToken } from '@tx-agent-kit/auth'
import { getPermissionsForRole } from '@tx-agent-kit/contracts'
import {
  authLoginAuditEventsRepository,
  authLoginIdentitiesRepository,
  authLoginRefreshTokensRepository,
  authLoginSessionsRepository,
  organizationsRepository,
  passwordResetTokensRepository,
  usersRepository,
  type JsonObject
} from '@tx-agent-kit/db'
import { Effect, Layer, Option } from 'effect'
import { mapOptional, toAuthUserRecord } from '../../../adapters/db-row-mappers.js'
import {
  AuthLoginAuditPort,
  AuthLoginIdentityPort,
  AuthLoginRefreshTokenPort,
  AuthLoginSessionPort,
  AuthOrganizationMembershipPort,
  AuthOrganizationOwnershipPort,
  AuthUsersPort,
  PasswordHasherPort,
  PasswordResetTokenPort,
  SessionTokenPort
} from '../ports/auth-ports.js'

const hashPasswordResetToken = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex')

const hashRefreshToken = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex')

const createOpaqueToken = (): string =>
  randomBytes(32).toString('base64url')

const defaultSessionTtlMs = 30 * 24 * 60 * 60 * 1000
const defaultRefreshTokenTtlMs = 30 * 24 * 60 * 60 * 1000

const toExpiryDate = (ttlMs: number): Date => new Date(Date.now() + ttlMs)

const toJsonObject = (metadata: Record<string, unknown>): JsonObject => {
  const entries = Object.entries(metadata)
  const normalized = entries.map(([key, value]) => {
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      value === null
    ) {
      return [key, value] as const
    }

    return [key, JSON.stringify(value)] as const
  })

  return Object.fromEntries(normalized)
}

export const AuthUsersPortLive = Layer.succeed(AuthUsersPort, {
  create: (input: { email: string; passwordHash: string; name: string }) =>
    usersRepository.create(input).pipe(Effect.map((opt) => mapOptional(opt, toAuthUserRecord))),
  findByEmail: (email: string) =>
    usersRepository.findByEmail(email).pipe(Effect.map((opt) => mapOptional(opt, toAuthUserRecord))),
  findById: (id: string) => usersRepository.findById(id).pipe(Effect.map((opt) => mapOptional(opt, toAuthUserRecord))),
  updatePasswordHash: (id: string, passwordHash: string) =>
    usersRepository
      .updatePasswordHash(id, passwordHash)
      .pipe(Effect.map((opt) => mapOptional(opt, toAuthUserRecord))),
  deleteById: (id: string) =>
    usersRepository.deleteById(id).pipe(Effect.map((opt) => mapOptional(opt, toAuthUserRecord)))
})

export const AuthOrganizationOwnershipPortLive = Layer.succeed(AuthOrganizationOwnershipPort, {
  countOwnedByUser: (userId: string) => organizationsRepository.countOwnedByUser(userId)
})

export const AuthOrganizationMembershipPortLive = Layer.succeed(AuthOrganizationMembershipPort, {
  getPrimaryMembershipForUser: (userId: string) =>
    organizationsRepository.getPrimaryMembershipForUser(userId).pipe(
      Effect.map((membershipOpt) =>
        Option.map(membershipOpt, (m) => ({
          organizationId: m.organizationId,
          role: m.role,
          permissions: getPermissionsForRole(m.role)
        }))
      )
    )
})

export const PasswordHasherPortLive = Layer.succeed(PasswordHasherPort, {
  hash: (plainText: string) => hashPassword(plainText),
  verify: (plainText: string, hash: string) => verifyPassword(plainText, hash)
})

export const SessionTokenPortLive = Layer.succeed(SessionTokenPort, {
  sign: (payload: { sub: string; email: string; pwd: number; sid: string }) => signSessionToken(payload),
  verify: (token: string) => verifySessionToken(token)
})

export const AuthLoginSessionPortLive = Layer.succeed(AuthLoginSessionPort, {
  create: (input: {
    userId: string
    provider: 'password' | 'google'
    createdIp: string | null
    createdUserAgent: string | null
  }) =>
    authLoginSessionsRepository.create({
      userId: input.userId,
      provider: input.provider,
      createdIp: input.createdIp,
      createdUserAgent: input.createdUserAgent,
      expiresAt: toExpiryDate(defaultSessionTtlMs)
    }).pipe(
      Effect.map(Option.map((session) => ({
        sessionId: session.id,
        expiresAt: session.expiresAt
      })))
    ),
  findActiveById: (sessionId: string) =>
    authLoginSessionsRepository.findActiveById(sessionId).pipe(
      Effect.map(Option.map((session) => ({
        sessionId: session.id,
        userId: session.userId,
        expiresAt: session.expiresAt
      })))
    ),
  touchById: (sessionId: string) => authLoginSessionsRepository.touchById(sessionId).pipe(Effect.asVoid),
  revokeById: (sessionId: string) => authLoginSessionsRepository.revokeById(sessionId),
  revokeAllForUser: (userId: string) => authLoginSessionsRepository.revokeAllForUser(userId)
})

export const AuthLoginRefreshTokenPortLive = Layer.succeed(AuthLoginRefreshTokenPort, {
  issueForSession: (sessionId: string) =>
    Effect.gen(function* () {
      const refreshToken = createOpaqueToken()
      const expiresAt = toExpiryDate(defaultRefreshTokenTtlMs)
      const created = yield* authLoginRefreshTokensRepository.create({
        sessionId,
        tokenHash: hashRefreshToken(refreshToken),
        expiresAt
      })

      if (Option.isNone(created)) {
        return yield* Effect.fail(new Error('Failed to create auth login refresh token'))
      }

      return {
        refreshToken,
        expiresAt
      }
    }),
  rotate: (refreshToken: string) =>
    Effect.gen(function* () {
      const tokenHash = hashRefreshToken(refreshToken)
      const consumed = yield* authLoginRefreshTokensRepository.consumeActiveByTokenHash(tokenHash)

      if (Option.isSome(consumed)) {
        const nextToken = createOpaqueToken()
        const nextExpiresAt = toExpiryDate(defaultRefreshTokenTtlMs)
        const created = yield* authLoginRefreshTokensRepository.create({
          sessionId: consumed.value.sessionId,
          tokenHash: hashRefreshToken(nextToken),
          expiresAt: nextExpiresAt
        })

        if (Option.isNone(created)) {
          return yield* Effect.fail(new Error('Failed to rotate auth login refresh token'))
        }

        return Option.some({
          sessionId: consumed.value.sessionId,
          refreshToken: nextToken,
          expiresAt: nextExpiresAt
        })
      }

      const existing = yield* authLoginRefreshTokensRepository.findByTokenHash(tokenHash)
      if (Option.isSome(existing) && existing.value.usedAt) {
        yield* authLoginRefreshTokensRepository.revokeActiveForSession(existing.value.sessionId).pipe(Effect.asVoid)
        yield* authLoginSessionsRepository.revokeById(existing.value.sessionId).pipe(Effect.asVoid)
      }

      return Option.none()
    }),
  revokeForSession: (sessionId: string) =>
    authLoginRefreshTokensRepository.revokeActiveForSession(sessionId).pipe(Effect.asVoid),
  revokeAllForUser: (userId: string) =>
    authLoginRefreshTokensRepository.revokeAllActiveForUser(userId).pipe(Effect.asVoid)
})

export const PasswordResetTokenPortLive = Layer.succeed(PasswordResetTokenPort, {
  createToken: (userId: string) =>
    Effect.gen(function* () {
      const token = createOpaqueToken()
      const tokenHash = hashPasswordResetToken(token)

      const created = yield* passwordResetTokensRepository.create({
        userId,
        tokenHash
      })

      if (Option.isNone(created)) {
        return yield* Effect.fail(new Error('Failed to create password reset token'))
      }

      return token
    }),

  consumeToken: (token: string) =>
    passwordResetTokensRepository.consumeByTokenHash(hashPasswordResetToken(token)),

  revokeTokensForUser: (userId: string) =>
    passwordResetTokensRepository.revokeActiveForUser(userId).pipe(Effect.asVoid)
})

export const AuthLoginIdentityPortLive = Layer.succeed(AuthLoginIdentityPort, {
  findByProviderSubject: (input: { provider: 'password' | 'google'; providerSubject: string }) =>
    authLoginIdentitiesRepository
      .findByProviderSubject(input.provider, input.providerSubject)
      .pipe(
        Effect.map(Option.map((identity) => ({
          userId: identity.userId,
          provider: identity.provider,
          providerSubject: identity.providerSubject,
          email: identity.email
        })))
      ),

  findByUserProvider: (input: { userId: string; provider: 'password' | 'google' }) =>
    authLoginIdentitiesRepository
      .findByUserProvider(input.userId, input.provider)
      .pipe(
        Effect.map(Option.map((identity) => ({
          userId: identity.userId,
          provider: identity.provider,
          providerSubject: identity.providerSubject,
          email: identity.email
        })))
      ),

  linkIdentity: (input: {
    userId: string
    provider: 'password' | 'google'
    providerSubject: string
    email: string
    emailVerified: boolean
  }) =>
    authLoginIdentitiesRepository
      .create({
        userId: input.userId,
        provider: input.provider,
        providerSubject: input.providerSubject,
        email: input.email,
        emailVerified: input.emailVerified
      })
      .pipe(
        Effect.map(Option.map((identity) => ({
          userId: identity.userId,
          provider: identity.provider,
          providerSubject: identity.providerSubject,
          email: identity.email
        })))
      ),

  unlinkIdentity: (input: {
    userId: string
    provider: 'password' | 'google'
  }) =>
    authLoginIdentitiesRepository
      .deleteByUserProvider(input.userId, input.provider)
      .pipe(
        Effect.map(Option.map((identity) => ({
          userId: identity.userId,
          provider: identity.provider,
          providerSubject: identity.providerSubject,
          email: identity.email
        })))
      )
})

export const AuthLoginAuditPortLive = Layer.succeed(AuthLoginAuditPort, {
  record: (input: {
    userId: string | null
    eventType: 'login_success' | 'login_failure' | 'password_reset_requested' | 'password_changed' | 'oauth_linked' | 'oauth_unlinked' | 'session_refreshed' | 'session_revoked' | 'account_deleted'
    status: 'success' | 'failure'
    identifier: string | null
    ipAddress: string | null
    metadata: Record<string, unknown>
  }) =>
    authLoginAuditEventsRepository
      .create({
        userId: input.userId,
        eventType: input.eventType,
        status: input.status,
        identifier: input.identifier,
        ipAddress: input.ipAddress,
        metadata: toJsonObject(input.metadata)
      })
      .pipe(Effect.asVoid)
})
