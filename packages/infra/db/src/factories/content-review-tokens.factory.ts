import crypto from 'node:crypto'
import type { contentReviewTokens } from '../schema.js'
import { generateId, generateFutureTimestamp, generateTimestamp } from './factory-helpers.js'

type ContentReviewTokenInsert = typeof contentReviewTokens.$inferInsert

export interface CreateContentReviewTokenFactoryOptions {
  teamId: string
  createdBy: string
  id?: string
  token?: string
  expiresAt?: Date
  revokedAt?: Date | null
  permissions?: string[]
  reviewerName?: string | null
  reviewerEmail?: string | null
  lastAccessedAt?: Date | null
  createdAt?: Date
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

export const createContentReviewTokenFactory = (
  options: CreateContentReviewTokenFactoryOptions
): ContentReviewTokenInsert => {
  return {
    id: options.id ?? generateId(),
    teamId: options.teamId,
    token: options.token ?? crypto.randomBytes(32).toString('hex'),
    expiresAt: options.expiresAt ?? generateFutureTimestamp(SEVEN_DAYS_MS),
    revokedAt: options.revokedAt ?? null,
    permissions: options.permissions ?? ['view'],
    reviewerName: options.reviewerName ?? null,
    reviewerEmail: options.reviewerEmail ?? null,
    lastAccessedAt: options.lastAccessedAt ?? null,
    createdBy: options.createdBy,
    createdAt: options.createdAt ?? generateTimestamp()
  }
}
