import { randomBytes } from 'node:crypto'
import { Context, Effect, Layer, Option } from 'effect'
import { badRequest, conflict, notFound, unauthorized, type CoreError } from '../../../errors.js'
import {
  type CompleteGoogleAuthCommand,
  type ForgotPasswordCommand,
  type GoogleAuthStartResult,
  isValidDisplayName,
  isValidEmail,
  normalizeEmail,
  type RefreshSessionCommand,
  type ResetPasswordCommand,
  type StartGoogleAuthCommand,
  toAuthPrincipal,
  toAuthUser,
  type AuthPrincipal,
  type AuthSession,
  type SignInCommand,
  type SignUpCommand,
  type AuthUserRecord
} from '../domain/auth-domain.js'
import {
  AuthLoginAuditPort,
  AuthLoginIdentityPort,
  AuthLoginRefreshTokenPort,
  AuthLoginSessionPort,
  AuthOrganizationMembershipPort,
  AuthOrganizationOwnershipPort,
  AuthUsersPort,
  GoogleOidcPort,
  PasswordResetEmailPort,
  PasswordResetTokenPort,
  PasswordHasherPort,
  SessionTokenPort
} from '../ports/auth-ports.js'

interface AuthRequestContext {
  ipAddress?: string
  userAgent?: string
}

const isEmailUniqueViolation = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') {
    return false
  }

  const code = 'code' in error ? String((error as { code?: unknown }).code) : ''
  return code === 'DB_USER_EMAIL_UNIQUE_VIOLATION'
}

const isAuthLoginIdentityUniqueViolation = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') {
    return false
  }

  const code = 'code' in error ? String((error as { code?: unknown }).code) : ''
  return code === 'DB_AUTH_LOGIN_IDENTITY_UNIQUE_VIOLATION'
}

const recordAuditEvent = (
  input: {
    userId: string | null
    eventType: 'login_success' | 'login_failure' | 'password_reset_requested' | 'password_changed' | 'oauth_linked' | 'oauth_unlinked' | 'session_refreshed' | 'session_revoked' | 'account_deleted'
    status: 'success' | 'failure'
    identifier: string | null
    ipAddress: string | null
    metadata?: Record<string, unknown>
  }
): Effect.Effect<void, never, AuthLoginAuditPort> =>
  Effect.gen(function* () {
    const auditPort = yield* AuthLoginAuditPort

    yield* auditPort.record({
      userId: input.userId,
      eventType: input.eventType,
      status: input.status,
      identifier: input.identifier,
      ipAddress: input.ipAddress,
      metadata: input.metadata ?? {}
    }).pipe(
      Effect.catchAll((_cause) => Effect.void)
    )
  })

const buildSession = (
  user: AuthUserRecord,
  provider: 'password' | 'google',
  context: AuthRequestContext
): Effect.Effect<
  AuthSession,
  CoreError,
  AuthLoginSessionPort | AuthLoginRefreshTokenPort | SessionTokenPort
> =>
  Effect.gen(function* () {
    const loginSessionPort = yield* AuthLoginSessionPort
    const refreshTokenPort = yield* AuthLoginRefreshTokenPort
    const sessionTokenPort = yield* SessionTokenPort

    const createdSession = yield* loginSessionPort
      .create({
        userId: user.id,
        provider,
        createdIp: context.ipAddress ?? null,
        createdUserAgent: context.userAgent ?? null
      })
      .pipe(
        Effect.mapError((cause) => unauthorized('Failed to create login session', cause)),
        Effect.flatMap(Option.match({
          onNone: () => Effect.fail(unauthorized('Failed to create login session')),
          onSome: Effect.succeed
        }))
      )

    const token = yield* sessionTokenPort.sign({
      sub: user.id,
      email: user.email,
      pwd: user.passwordChangedAt.getTime(),
      sid: createdSession.sessionId
    }).pipe(Effect.mapError((cause) => unauthorized('Failed to create access token', cause)))

    const refresh = yield* refreshTokenPort
      .issueForSession(createdSession.sessionId)
      .pipe(Effect.mapError((cause) => unauthorized('Failed to issue refresh token', cause)))

    return {
      token,
      refreshToken: refresh.refreshToken,
      user: toAuthUser(user)
    }
  })

export class AuthService extends Context.Tag('AuthService')<
  AuthService,
  {
    signUp: (
      input: SignUpCommand,
      context?: AuthRequestContext
    ) => Effect.Effect<
      AuthSession,
      CoreError,
      AuthUsersPort | PasswordHasherPort | SessionTokenPort | AuthLoginSessionPort | AuthLoginRefreshTokenPort | AuthLoginAuditPort
    >
    signIn: (
      input: SignInCommand,
      context?: AuthRequestContext
    ) => Effect.Effect<
      AuthSession,
      CoreError,
      AuthUsersPort | PasswordHasherPort | SessionTokenPort | AuthLoginSessionPort | AuthLoginRefreshTokenPort | AuthLoginAuditPort
    >
    refreshSession: (
      input: RefreshSessionCommand
    ) => Effect.Effect<
      AuthSession,
      CoreError,
      AuthUsersPort | SessionTokenPort | AuthLoginSessionPort | AuthLoginRefreshTokenPort | AuthLoginAuditPort
    >
    signOutSession: (
      principal: AuthPrincipal
    ) => Effect.Effect<
      { revoked: true },
      CoreError,
      AuthLoginSessionPort | AuthLoginRefreshTokenPort | AuthLoginAuditPort
    >
    signOutAllSessions: (
      principal: { userId: string }
    ) => Effect.Effect<
      { revokedSessions: number },
      CoreError,
      AuthLoginSessionPort | AuthLoginRefreshTokenPort | AuthLoginAuditPort
    >
    startGoogleAuth: (
      input: StartGoogleAuthCommand
    ) => Effect.Effect<GoogleAuthStartResult, CoreError, GoogleOidcPort>
    completeGoogleAuth: (
      input: CompleteGoogleAuthCommand
    ) => Effect.Effect<
      AuthSession,
      CoreError,
      AuthUsersPort | PasswordHasherPort | SessionTokenPort | AuthLoginSessionPort | AuthLoginRefreshTokenPort | AuthLoginIdentityPort | GoogleOidcPort | AuthLoginAuditPort
    >
    requestPasswordReset: (
      input: ForgotPasswordCommand,
      context?: AuthRequestContext
    ) => Effect.Effect<
      { accepted: true },
      CoreError,
      AuthUsersPort | PasswordResetTokenPort | PasswordResetEmailPort | AuthLoginAuditPort
    >
    resetPassword: (
      input: ResetPasswordCommand,
      context?: AuthRequestContext
    ) => Effect.Effect<
      { reset: true },
      CoreError,
      AuthUsersPort | PasswordHasherPort | PasswordResetTokenPort | AuthLoginSessionPort | AuthLoginRefreshTokenPort | AuthLoginAuditPort
    >
    getPrincipalFromToken: (
      token: string
    ) => Effect.Effect<AuthPrincipal, CoreError, AuthUsersPort | SessionTokenPort | AuthOrganizationMembershipPort | AuthLoginSessionPort>
    deleteUser: (
      principal: { userId: string }
    ) => Effect.Effect<{ deleted: true }, CoreError, AuthUsersPort | AuthOrganizationOwnershipPort | AuthLoginSessionPort | AuthLoginRefreshTokenPort | AuthLoginAuditPort>
  }
>() {}

export const AuthServiceLive = Layer.effect(
  AuthService,
  Effect.succeed({
    signUp: (input, context = {}) =>
      Effect.gen(function* () {
        const usersPort = yield* AuthUsersPort
        const passwordHasher = yield* PasswordHasherPort

        if (!isValidEmail(input.email) || !isValidDisplayName(input.name) || input.password.length < 8) {
          yield* recordAuditEvent({
            userId: null,
            eventType: 'login_failure',
            status: 'failure',
            identifier: normalizeEmail(input.email),
            ipAddress: context.ipAddress ?? null,
            metadata: { reason: 'invalid_sign_up_payload' }
          })
          return yield* Effect.fail(badRequest('Invalid sign-up payload'))
        }

        const email = normalizeEmail(input.email)
        const name = input.name.trim()

        const existingOpt = yield* usersPort.findByEmail(email).pipe(
          Effect.mapError((cause) => badRequest('Sign-up failed', cause))
        )

        if (Option.isSome(existingOpt)) {
          yield* recordAuditEvent({
            userId: existingOpt.value.id,
            eventType: 'login_failure',
            status: 'failure',
            identifier: email,
            ipAddress: context.ipAddress ?? null,
            metadata: { reason: 'email_already_used' }
          })
          return yield* Effect.fail(conflict('Email is already in use'))
        }

        const passwordHash = yield* passwordHasher.hash(input.password).pipe(
          Effect.mapError((cause) => badRequest('Could not hash password', cause))
        )

        const created = yield* usersPort.create({
          email,
          passwordHash,
          name
        }).pipe(
          Effect.catchAll((error) =>
            isEmailUniqueViolation(error)
              ? Effect.fail(conflict('Email is already in use'))
              : Effect.fail(badRequest('Sign-up failed'))
          ),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(badRequest('User creation failed')),
            onSome: Effect.succeed
          }))
        )

        const session = yield* buildSession(created, 'password', context)

        yield* recordAuditEvent({
          userId: created.id,
          eventType: 'login_success',
          status: 'success',
          identifier: email,
          ipAddress: context.ipAddress ?? null,
          metadata: { provider: 'password', flow: 'sign_up' }
        })

        return session
      }),

    signIn: (input, context = {}) =>
      Effect.gen(function* () {
        const usersPort = yield* AuthUsersPort
        const passwordHasher = yield* PasswordHasherPort

        if (!isValidEmail(input.email)) {
          yield* recordAuditEvent({
            userId: null,
            eventType: 'login_failure',
            status: 'failure',
            identifier: normalizeEmail(input.email),
            ipAddress: context.ipAddress ?? null,
            metadata: { reason: 'invalid_sign_in_payload' }
          })
          return yield* Effect.fail(unauthorized('Invalid credentials'))
        }

        const email = normalizeEmail(input.email)

        const user = yield* usersPort.findByEmail(email).pipe(
          Effect.mapError((cause) => unauthorized('Invalid credentials', cause)),
          Effect.flatMap(Option.match({
            onNone: () => {
              return recordAuditEvent({
                userId: null,
                eventType: 'login_failure',
                status: 'failure',
                identifier: email,
                ipAddress: context.ipAddress ?? null,
                metadata: { reason: 'missing_user' }
              }).pipe(Effect.flatMap(() => Effect.fail(unauthorized('Invalid credentials'))))
            },
            onSome: Effect.succeed
          }))
        )

        const ok = yield* passwordHasher.verify(input.password, user.passwordHash).pipe(
          Effect.mapError((cause) => unauthorized('Invalid credentials', cause))
        )

        if (!ok) {
          yield* recordAuditEvent({
            userId: user.id,
            eventType: 'login_failure',
            status: 'failure',
            identifier: email,
            ipAddress: context.ipAddress ?? null,
            metadata: { reason: 'invalid_password' }
          })
          return yield* Effect.fail(unauthorized('Invalid credentials'))
        }

        const session = yield* buildSession(user, 'password', context)

        yield* recordAuditEvent({
          userId: user.id,
          eventType: 'login_success',
          status: 'success',
          identifier: email,
          ipAddress: context.ipAddress ?? null,
          metadata: { provider: 'password', flow: 'sign_in' }
        })

        return session
      }),

    refreshSession: (input) =>
      Effect.gen(function* () {
        const usersPort = yield* AuthUsersPort
        const refreshTokenPort = yield* AuthLoginRefreshTokenPort
        const sessionTokenPort = yield* SessionTokenPort
        const loginSessionPort = yield* AuthLoginSessionPort

        if (input.refreshToken.trim().length < 1) {
          return yield* Effect.fail(unauthorized('Invalid refresh token'))
        }

        const rotated = yield* refreshTokenPort.rotate(input.refreshToken).pipe(
          Effect.mapError((cause) => unauthorized('Invalid refresh token', cause)),
          Effect.flatMap(Option.match({
            onNone: () => {
              return recordAuditEvent({
                userId: null,
                eventType: 'session_refreshed',
                status: 'failure',
                identifier: null,
                ipAddress: null,
                metadata: { reason: 'refresh_token_rejected' }
              }).pipe(Effect.flatMap(() => Effect.fail(unauthorized('Invalid refresh token'))))
            },
            onSome: Effect.succeed
          }))
        )

        const activeSession = yield* loginSessionPort.findActiveById(rotated.sessionId).pipe(
          Effect.tapError((_cause) =>
            refreshTokenPort.revokeForSession(rotated.sessionId).pipe(Effect.catchAll((_cause2) => Effect.void))
          ),
          Effect.mapError((cause) => unauthorized('Invalid refresh session', cause)),
          Effect.flatMap(Option.match({
            onNone: () => {
              return refreshTokenPort.revokeForSession(rotated.sessionId).pipe(
                Effect.catchAll((_cause) => Effect.void),
                Effect.flatMap(() => recordAuditEvent({
                  userId: null,
                  eventType: 'session_refreshed',
                  status: 'failure',
                  identifier: null,
                  ipAddress: null,
                  metadata: { reason: 'session_inactive', sessionId: rotated.sessionId }
                })),
                Effect.flatMap(() => Effect.fail(unauthorized('Invalid refresh session')))
              )
            },
            onSome: Effect.succeed
          }))
        )

        const user = yield* usersPort.findById(activeSession.userId).pipe(
          Effect.mapError((cause) => unauthorized('Invalid refresh session', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(unauthorized('Invalid refresh session')),
            onSome: Effect.succeed
          }))
        )

        yield* loginSessionPort.touchById(activeSession.sessionId).pipe(
          Effect.catchAll((_cause) => Effect.void)
        )

        const token = yield* sessionTokenPort.sign({
          sub: user.id,
          email: user.email,
          pwd: user.passwordChangedAt.getTime(),
          sid: activeSession.sessionId
        }).pipe(Effect.mapError((cause) => unauthorized('Failed to issue access token', cause)))

        yield* recordAuditEvent({
          userId: user.id,
          eventType: 'session_refreshed',
          status: 'success',
          identifier: user.email,
          ipAddress: null,
          metadata: { sessionId: activeSession.sessionId }
        })

        return {
          token,
          refreshToken: rotated.refreshToken,
          user: toAuthUser(user)
        }
      }),

    signOutSession: (principal) =>
      Effect.gen(function* () {
        const loginSessionPort = yield* AuthLoginSessionPort
        const refreshTokenPort = yield* AuthLoginRefreshTokenPort

        if (!principal.sessionId) {
          return yield* Effect.fail(unauthorized('Invalid token'))
        }

        yield* refreshTokenPort.revokeForSession(principal.sessionId).pipe(
          Effect.catchAll((_cause) => Effect.void)
        )

        yield* loginSessionPort.revokeById(principal.sessionId).pipe(
          Effect.mapError((cause) => badRequest('Failed to revoke session', cause))
        )

        yield* recordAuditEvent({
          userId: principal.userId,
          eventType: 'session_revoked',
          status: 'success',
          identifier: principal.email,
          ipAddress: null,
          metadata: { scope: 'single_session', sessionId: principal.sessionId }
        })

        return { revoked: true as const }
      }),

    signOutAllSessions: (principal) =>
      Effect.gen(function* () {
        const loginSessionPort = yield* AuthLoginSessionPort
        const refreshTokenPort = yield* AuthLoginRefreshTokenPort

        yield* refreshTokenPort.revokeAllForUser(principal.userId).pipe(
          Effect.catchAll((_cause) => Effect.void)
        )

        // Use catchAll (non-fatal) — consistent with resetPassword and deleteUser.
        // A transient DB hiccup should not prevent a user from signing out.
        const revokedSessions = yield* loginSessionPort.revokeAllForUser(principal.userId).pipe(
          Effect.catchAll((_cause) => Effect.succeed(0))
        )

        yield* recordAuditEvent({
          userId: principal.userId,
          eventType: 'session_revoked',
          status: 'success',
          identifier: null,
          ipAddress: null,
          metadata: { scope: 'all_sessions', revokedSessions }
        })

        return { revokedSessions }
      }),

    startGoogleAuth: (input) =>
      Effect.gen(function* () {
        const googleOidcPort = yield* GoogleOidcPort

        return yield* googleOidcPort
          .startAuthorization({
            ipAddress: input.ipAddress ?? null,
            statePrefix: input.statePrefix
          })
          .pipe(Effect.mapError((cause) => badRequest('Failed to start Google authorization', cause)))
      }),

    completeGoogleAuth: (input) =>
      Effect.gen(function* () {
        const usersPort = yield* AuthUsersPort
        const passwordHasher = yield* PasswordHasherPort
        const googleOidcPort = yield* GoogleOidcPort
        const identityPort = yield* AuthLoginIdentityPort

        const identity = yield* googleOidcPort.completeAuthorization({
          code: input.code,
          state: input.state
        }).pipe(Effect.mapError((cause) => unauthorized('Invalid Google authorization response', cause)))

        const normalizedEmail = normalizeEmail(identity.email)

        if (!identity.emailVerified) {
          yield* recordAuditEvent({
            userId: null,
            eventType: 'login_failure',
            status: 'failure',
            identifier: normalizedEmail,
            ipAddress: input.ipAddress ?? null,
            metadata: { reason: 'google_email_not_verified' }
          })
          return yield* Effect.fail(unauthorized('Google account email must be verified'))
        }

        const linkedIdentityOpt = yield* identityPort.findByProviderSubject({
          provider: 'google',
          providerSubject: identity.providerSubject
        }).pipe(Effect.mapError((cause) => badRequest('Failed to read Google identity link', cause)))

        let userOpt: Option.Option<AuthUserRecord> = Option.isSome(linkedIdentityOpt)
          ? yield* usersPort.findById(linkedIdentityOpt.value.userId).pipe(
              Effect.mapError((cause) => badRequest('Failed to read linked user', cause))
            )
          : Option.none()

        let didLinkIdentity = false

        if (Option.isNone(userOpt)) {
          const existingUserOpt = yield* usersPort.findByEmail(normalizedEmail).pipe(
            Effect.mapError((cause) => badRequest('Failed to read existing user', cause))
          )

          if (Option.isSome(existingUserOpt)) {
            userOpt = existingUserOpt
          } else {
            const syntheticPassword = randomBytes(64).toString('base64url')
            const syntheticPasswordHash = yield* passwordHasher.hash(syntheticPassword).pipe(
              Effect.mapError((cause) => badRequest('Failed to generate Google account credentials', cause))
            )

            userOpt = yield* usersPort.create({
              email: normalizedEmail,
              passwordHash: syntheticPasswordHash,
              name: identity.name.trim().length > 0 ? identity.name : normalizedEmail
            }).pipe(
              Effect.catchAll((error) =>
                isEmailUniqueViolation(error)
                  ? Effect.fail(conflict('Email is already in use'))
                  : Effect.fail(badRequest('Google login failed'))
              )
            )
          }

          if (Option.isNone(userOpt)) {
            return yield* Effect.fail(badRequest('Google login failed'))
          }

          const user = userOpt.value

          const existingProviderLinkOpt = yield* identityPort.findByUserProvider({
            userId: user.id,
            provider: 'google'
          }).pipe(Effect.mapError((cause) => badRequest('Failed to read existing Google link', cause)))

          if (Option.isNone(existingProviderLinkOpt)) {
            const linkResultOpt = yield* identityPort.linkIdentity({
              userId: user.id,
              provider: 'google',
              providerSubject: identity.providerSubject,
              email: normalizedEmail,
              emailVerified: identity.emailVerified
            }).pipe(
              Effect.catchAll((error) =>
                isAuthLoginIdentityUniqueViolation(error)
                  ? Effect.succeed(Option.none())
                  : Effect.fail(error)
              ),
              Effect.mapError((cause) => badRequest('Failed to link Google identity', cause))
            )
            didLinkIdentity = Option.isSome(linkResultOpt)
          }
        }

        if (Option.isNone(userOpt)) {
          return yield* Effect.fail(badRequest('Google login failed — user record not found'))
        }
        const user = userOpt.value

        const session = yield* buildSession(user, 'google', {
          ipAddress: input.ipAddress,
          userAgent: input.userAgent
        })

        if (didLinkIdentity) {
          yield* recordAuditEvent({
            userId: user.id,
            eventType: 'oauth_linked',
            status: 'success',
            identifier: normalizedEmail,
            ipAddress: input.ipAddress ?? null,
            metadata: { provider: 'google' }
          })
        }

        yield* recordAuditEvent({
          userId: user.id,
          eventType: 'login_success',
          status: 'success',
          identifier: normalizedEmail,
          ipAddress: input.ipAddress ?? null,
          metadata: { provider: 'google', flow: 'oidc' }
        })

        return session
      }),

    requestPasswordReset: (input, context = {}) =>
      Effect.gen(function* () {
        const usersPort = yield* AuthUsersPort
        const passwordResetTokenPort = yield* PasswordResetTokenPort
        const passwordResetEmailPort = yield* PasswordResetEmailPort

        if (!isValidEmail(input.email)) {
          yield* recordAuditEvent({
            userId: null,
            eventType: 'password_reset_requested',
            status: 'failure',
            identifier: normalizeEmail(input.email),
            ipAddress: context.ipAddress ?? null,
            metadata: { reason: 'invalid_forgot_password_payload' }
          })
          return yield* Effect.fail(badRequest('Invalid forgot-password payload'))
        }

        const email = normalizeEmail(input.email)
        const userOpt = yield* usersPort.findByEmail(email).pipe(
          Effect.mapError((cause) => badRequest('Failed to process forgot-password request', cause))
        )

        if (Option.isNone(userOpt)) {
          yield* recordAuditEvent({
            userId: null,
            eventType: 'password_reset_requested',
            status: 'success',
            identifier: email,
            ipAddress: context.ipAddress ?? null,
            metadata: { accountFound: false }
          })
          return { accepted: true as const }
        }

        const user = userOpt.value

        yield* passwordResetTokenPort.revokeTokensForUser(user.id).pipe(
          Effect.mapError((cause) => badRequest('Failed to process forgot-password request', cause))
        )

        const token = yield* passwordResetTokenPort.createToken(user.id).pipe(
          Effect.mapError((cause) => badRequest('Failed to process forgot-password request', cause))
        )

        yield* passwordResetEmailPort.sendPasswordResetEmail({
          email: user.email,
          name: user.name,
          token
        }).pipe(Effect.mapError((cause) => badRequest('Failed to process forgot-password request', cause)))

        yield* recordAuditEvent({
          userId: user.id,
          eventType: 'password_reset_requested',
          status: 'success',
          identifier: email,
          ipAddress: context.ipAddress ?? null,
          metadata: { accountFound: true }
        })

        return { accepted: true as const }
      }),

    resetPassword: (input, context = {}) =>
      Effect.gen(function* () {
        const usersPort = yield* AuthUsersPort
        const passwordHasher = yield* PasswordHasherPort
        const passwordResetTokenPort = yield* PasswordResetTokenPort

        if (input.token.trim().length < 1 || input.password.length < 8) {
          return yield* Effect.fail(badRequest('Invalid reset-password payload'))
        }

        const tokenPrincipal = yield* passwordResetTokenPort.consumeToken(input.token).pipe(
          Effect.mapError((cause) => badRequest('Invalid or expired password reset token', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(badRequest('Invalid or expired password reset token')),
            onSome: Effect.succeed
          }))
        )

        const passwordHash = yield* passwordHasher.hash(input.password).pipe(
          Effect.mapError((cause) => badRequest('Could not hash password', cause))
        )

        const updatedUser = yield* usersPort
          .updatePasswordHash(tokenPrincipal.userId, passwordHash)
          .pipe(
            Effect.mapError((cause) => badRequest('Failed to reset password', cause)),
            Effect.flatMap(Option.match({
              onNone: () => Effect.fail(notFound('User not found')),
              onSome: Effect.succeed
            }))
          )

        yield* passwordResetTokenPort.revokeTokensForUser(tokenPrincipal.userId).pipe(
          Effect.catchAll(() => Effect.void)
        )

        const loginSessionPort = yield* AuthLoginSessionPort
        const refreshTokenPort = yield* AuthLoginRefreshTokenPort

        yield* refreshTokenPort.revokeAllForUser(tokenPrincipal.userId).pipe(
          Effect.catchAll((_cause) => Effect.void)
        )

        yield* loginSessionPort.revokeAllForUser(tokenPrincipal.userId).pipe(
          Effect.catchAll((_cause) => Effect.void)
        )

        yield* recordAuditEvent({
          userId: tokenPrincipal.userId,
          eventType: 'password_changed',
          status: 'success',
          identifier: updatedUser.email,
          ipAddress: context.ipAddress ?? null,
          metadata: {}
        })

        return { reset: true as const }
      }),

    getPrincipalFromToken: (token: string) =>
      Effect.gen(function* () {
        const usersPort = yield* AuthUsersPort
        const sessionTokenPort = yield* SessionTokenPort
        const membershipPort = yield* AuthOrganizationMembershipPort
        const loginSessionPort = yield* AuthLoginSessionPort

        const payload = yield* sessionTokenPort.verify(token).pipe(
          Effect.mapError((cause) => unauthorized('Invalid token', cause))
        )

        if (typeof payload.pwd !== 'number' || typeof payload.sid !== 'string') {
          return yield* Effect.fail(unauthorized('Invalid token'))
        }

        const activeSession = yield* loginSessionPort.findActiveById(payload.sid).pipe(
          Effect.mapError((cause) => unauthorized('Invalid token', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(unauthorized('Invalid token')),
            onSome: Effect.succeed
          }))
        )

        if (activeSession.userId !== payload.sub) {
          return yield* Effect.fail(unauthorized('Invalid token'))
        }

        const user = yield* usersPort.findById(payload.sub).pipe(
          Effect.mapError((cause) => unauthorized('Invalid token', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(unauthorized('Invalid token')),
            onSome: Effect.succeed
          }))
        )

        if (payload.pwd < user.passwordChangedAt.getTime()) {
          return yield* Effect.fail(unauthorized('Invalid token'))
        }

        yield* loginSessionPort.touchById(payload.sid).pipe(
          Effect.catchAll((_cause) => Effect.void)
        )

        const primaryMembershipOpt = yield* membershipPort.getPrimaryMembershipForUser(user.id).pipe(
          Effect.mapError((cause) => unauthorized('Invalid token', cause))
        )

        const primaryMembership = Option.getOrUndefined(primaryMembershipOpt)

        return toAuthPrincipal({
          sub: user.id,
          email: user.email,
          sid: payload.sid,
          organizationId: primaryMembership?.organizationId,
          role: primaryMembership?.role,
          permissions: primaryMembership?.permissions ?? []
        })
      }),

    deleteUser: (principal) =>
      Effect.gen(function* () {
        const usersPort = yield* AuthUsersPort
        const organizationOwnershipPort = yield* AuthOrganizationOwnershipPort
        const loginSessionPort = yield* AuthLoginSessionPort
        const refreshTokenPort = yield* AuthLoginRefreshTokenPort

        const existing = yield* usersPort.findById(principal.userId).pipe(
          Effect.mapError((cause) => badRequest('Failed to read user', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('User not found')),
            onSome: Effect.succeed
          }))
        )

        const ownedOrganizationCount = yield* organizationOwnershipPort.countOwnedByUser(principal.userId).pipe(
          Effect.mapError((cause) => badRequest('Failed to validate organization ownership', cause))
        )

        if (ownedOrganizationCount > 0) {
          return yield* Effect.fail(conflict('Cannot delete account while owning organizations. Transfer ownership first.'))
        }

        yield* refreshTokenPort.revokeAllForUser(principal.userId).pipe(
          Effect.catchAll((_cause) => Effect.void)
        )

        yield* loginSessionPort.revokeAllForUser(principal.userId).pipe(
          Effect.catchAll((_cause) => Effect.void)
        )

        yield* usersPort.deleteById(principal.userId).pipe(
          Effect.mapError((cause) => badRequest('Failed to delete user', cause)),
          Effect.flatMap(Option.match({
            onNone: () => Effect.fail(notFound('User not found')),
            onSome: Effect.succeed
          }))
        )

        yield* recordAuditEvent({
          userId: principal.userId,
          eventType: 'account_deleted',
          status: 'success',
          identifier: existing.email,
          ipAddress: null,
          metadata: {}
        })

        return { deleted: true as const }
      })
  })
)
