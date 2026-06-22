/**
 * Shared props superset for every lifecycle email template.
 *
 * Each template consumes only the fields it needs and falls back gracefully
 * when an optional field is missing, so a renderer never throws on absent
 * `templateData`. The registry types its renderers against this single shape,
 * which keeps the campaign engine's call site uniform across all 16 templates.
 */
export interface LifecycleEmailProps {
  /** Display name for the recipient. Falls back to a neutral greeting. */
  readonly userName: string
  /** Primary call-to-action link (per-template meaning). */
  readonly ctaUrl?: string
  /** Public feedback board URL (feedback-ask). */
  readonly feedbackBoardUrl?: string
  /** Public roadmap URL ("Shape the roadmap ->"). */
  readonly roadmapUrl?: string
  /** App home URL, used when a template has no more specific CTA. */
  readonly appUrl?: string
  /** Formatted credit balance (e.g. "$20.00"), credits templates. */
  readonly creditBalanceUsd?: string
  /** One-click unsubscribe URL, rendered in the footer. */
  readonly unsubscribeUrl?: string
}

/** Safe greeting that never leaks an empty name. */
export const greetingName = (userName: string | undefined): string => {
  const trimmed = (userName ?? '').trim()
  return trimmed.length > 0 ? trimmed : 'there'
}

/** Pick the first defined, non-empty URL or fall back to '#'. */
export const firstUrl = (...candidates: ReadonlyArray<string | undefined>): string => {
  for (const candidate of candidates) {
    const trimmed = (candidate ?? '').trim()
    if (trimmed.length > 0) {
      return trimmed
    }
  }
  return '#'
}
