// Colocated source module for brand-settings integration tests.
// Re-exports the public brand-settings contract types so the test file
// can import its domain types from a route-level module. Brand-settings
// shapes are served through the existing teams CRUD routes, so this is
// a type-only seam with no standalone handlers.
export const TeamsBrandRouteKind = 'custom' as const

export type {
  BrandSettings,
  BrandSettingsColors
} from '@tx-agent-kit/contracts'
