import type { AuthLoginProvider } from '@tx-agent-kit/contracts'
import type { authLoginIdentities } from '../schema.js'
import {
  generateEmail,
  generateId,
  generateTimestamp,
  generateUniqueValue
} from './factory-helpers.js'

type AuthLoginIdentityInsert = typeof authLoginIdentities.$inferInsert

export interface CreateAuthLoginIdentityFactoryOptions {
  id?: string
  userId: string
  provider?: AuthLoginProvider
  providerSubject?: string
  email?: string
  emailVerified?: boolean
  createdAt?: Date
}

export const createAuthLoginIdentityFactory = (
  options: CreateAuthLoginIdentityFactoryOptions
): AuthLoginIdentityInsert => {
  return {
    id: options.id ?? generateId(),
    userId: options.userId,
    provider: options.provider ?? 'google',
    providerSubject: options.providerSubject ?? generateUniqueValue('auth-login-provider-subject'),
    email: options.email ?? generateEmail('auth-login-identity'),
    emailVerified: options.emailVerified ?? false,
    createdAt: options.createdAt ?? generateTimestamp()
  }
}
