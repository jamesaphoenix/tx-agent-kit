import type { pendingUploads } from '../schema.js'
import { generateId, generateFutureTimestamp, generateTimestamp } from './factory-helpers.js'

type PendingUploadInsert = typeof pendingUploads.$inferInsert

export interface CreatePendingUploadFactoryOptions {
  teamId: string
  userId: string
  id?: string
  declaredFileSize?: number
  contentHash?: string | null
  mimeType?: string
  storagePath?: string
  presignedUrl?: string
  expiresAt?: Date
  createdAt?: Date
}

export const createPendingUploadFactory = (
  options: CreatePendingUploadFactoryOptions
): PendingUploadInsert => {
  const id = options.id ?? generateId()
  return {
    id,
    teamId: options.teamId,
    userId: options.userId,
    declaredFileSize: options.declaredFileSize ?? 1024,
    contentHash: options.contentHash ?? null,
    mimeType: options.mimeType ?? 'image/jpeg',
    storagePath: options.storagePath ?? `${options.teamId}/${id}_test.jpg`,
    presignedUrl: options.presignedUrl ?? `https://r2.example.com/${id}`,
    expiresAt: options.expiresAt ?? generateFutureTimestamp(3_600_000),
    createdAt: options.createdAt ?? generateTimestamp()
  }
}
