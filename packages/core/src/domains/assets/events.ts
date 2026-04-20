/**
 * Public cross-domain event contract for the assets domain.
 *
 * This file is the ONLY file other domains may import from this domain.
 * It exposes event type discriminants, typed payload shapes, and version constants.
 */

export type { AssetsThumbnailRequestedEventPayload } from './domain/assets-events.js'

export const assetsEvents = {
  thumbnailRequested: 'assets.thumbnail_requested'
} as const

export const assetsEventVersions = {
  'assets.thumbnail_requested': 1
} as const
