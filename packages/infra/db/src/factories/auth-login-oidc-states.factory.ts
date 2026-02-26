import type { AuthLoginProvider } from '@tx-agent-kit/contracts'
import type { authLoginOidcStates } from '../schema.js'
import {
  generateFutureTimestamp,
  generateId,
  generateTimestamp,
  generateUniqueValue
} from './factory-helpers.js'

type AuthLoginOidcStateInsert = typeof authLoginOidcStates.$inferInsert

export interface CreateAuthLoginOidcStateFactoryOptions {
  id?: string
  provider?: AuthLoginProvider
  state?: string
  nonce?: string
  codeVerifier?: string
  redirectUri?: string
  requesterIp?: string | null
  expiresAt?: Date
  consumedAt?: Date | null
  createdAt?: Date
}

export const createAuthLoginOidcStateFactory = (
  options: CreateAuthLoginOidcStateFactoryOptions = {}
): AuthLoginOidcStateInsert => {
  return {
    id: options.id ?? generateId(),
    provider: options.provider ?? 'google',
    state: options.state ?? generateUniqueValue('auth-login-oidc-state'),
    nonce: options.nonce ?? generateUniqueValue('auth-login-oidc-nonce'),
    codeVerifier: options.codeVerifier ?? generateUniqueValue('auth-login-oidc-code-verifier'),
    redirectUri: options.redirectUri ?? 'http://localhost/callback',
    requesterIp: options.requesterIp ?? null,
    expiresAt: options.expiresAt ?? generateFutureTimestamp(10 * 60 * 1000),
    consumedAt: options.consumedAt ?? null,
    createdAt: options.createdAt ?? generateTimestamp()
  }
}
