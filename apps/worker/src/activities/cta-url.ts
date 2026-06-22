/**
 * Lifecycle email CTA-surface resolution.
 *
 * The starter kit has no team-scoped deep links in its lifecycle emails: every
 * campaign step's `ctaSurface` is an app-level route (the design's `ctaSurfaces`
 * table). This keeps the engine portable - a fork re-themes by swapping the path
 * map below, with no per-tenant context to resolve. The resolved URL is always a
 * web (SPA) route the signed-in user lands on.
 */

/**
 * App-level CTA surfaces a lifecycle email step can target, mapped to the SPA
 * route the recipient should land on. A `Record<CtaSurface, string>` so adding a
 * surface key without a path is a compile error. Mirrors the design's
 * `ctaSurfaces` table.
 */
export const ctaSurfacePaths = {
  dashboard: '/dashboard',
  org: '/org',
  onboarding: '/org/onboarding',
  organizations: '/organizations',
  invitations: '/invitations',
  pricing: '/pricing'
} as const

export type CtaSurface = keyof typeof ctaSurfacePaths

export const isCtaSurface = (value: unknown): value is CtaSurface =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(ctaSurfacePaths, value)

const trimTrailingSlashes = (base: string): string => base.replace(/\/+$/, '')

/**
 * Resolve a lifecycle email's next-step action link, in priority order:
 *  1. a known app-level `ctaSurface` -> its SPA route under `baseUrl`;
 *  2. an explicit `ctaUrl` literal;
 *  3. otherwise the dashboard, which routes the signed-in user into an org/team
 *     they belong to.
 *
 * An unknown surface falls through to the dashboard, so a brand-new account
 * still gets a working link.
 */
export const resolveLifecycleCtaUrl = (input: {
  ctaSurface: unknown
  ctaUrl: string | undefined
  baseUrl: string
}): string => {
  const { ctaSurface, ctaUrl, baseUrl } = input
  const base = trimTrailingSlashes(baseUrl)

  if (isCtaSurface(ctaSurface)) {
    return `${base}${ctaSurfacePaths[ctaSurface]}`
  }
  if (ctaUrl !== undefined && ctaUrl.trim().length > 0) {
    return ctaUrl
  }
  return `${base}${ctaSurfacePaths.dashboard}`
}
