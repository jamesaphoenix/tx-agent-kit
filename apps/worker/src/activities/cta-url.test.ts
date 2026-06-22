import { describe, expect, it } from 'vitest'
import { isCtaSurface, resolveLifecycleCtaUrl } from './cta-url.js'

const BASE = 'https://app.example.com'

describe('resolveLifecycleCtaUrl', () => {
  it('resolves each app-level surface to its SPA route', () => {
    expect(resolveLifecycleCtaUrl({ ctaSurface: 'dashboard', ctaUrl: undefined, baseUrl: BASE })).toBe(
      'https://app.example.com/dashboard'
    )
    expect(resolveLifecycleCtaUrl({ ctaSurface: 'org', ctaUrl: undefined, baseUrl: BASE })).toBe(
      'https://app.example.com/org'
    )
    expect(resolveLifecycleCtaUrl({ ctaSurface: 'onboarding', ctaUrl: undefined, baseUrl: BASE })).toBe(
      'https://app.example.com/org/onboarding'
    )
    expect(resolveLifecycleCtaUrl({ ctaSurface: 'invitations', ctaUrl: undefined, baseUrl: BASE })).toBe(
      'https://app.example.com/invitations'
    )
    expect(resolveLifecycleCtaUrl({ ctaSurface: 'pricing', ctaUrl: undefined, baseUrl: BASE })).toBe(
      'https://app.example.com/pricing'
    )
  })

  it('trims a trailing slash on the base URL', () => {
    expect(resolveLifecycleCtaUrl({ ctaSurface: 'dashboard', ctaUrl: undefined, baseUrl: 'https://app.example.com/' })).toBe(
      'https://app.example.com/dashboard'
    )
  })

  it('honors an explicit ctaUrl literal when no surface is named', () => {
    expect(
      resolveLifecycleCtaUrl({ ctaSurface: undefined, ctaUrl: 'https://x/y', baseUrl: BASE })
    ).toBe('https://x/y')
  })

  it('defaults to the dashboard when nothing is specified or the surface is unknown', () => {
    expect(resolveLifecycleCtaUrl({ ctaSurface: undefined, ctaUrl: undefined, baseUrl: BASE })).toBe(
      'https://app.example.com/dashboard'
    )
    // An unknown surface string is ignored, not routed.
    expect(resolveLifecycleCtaUrl({ ctaSurface: 'bogus', ctaUrl: undefined, baseUrl: BASE })).toBe(
      'https://app.example.com/dashboard'
    )
  })
})

describe('isCtaSurface', () => {
  it('recognizes the design surfaces and rejects others', () => {
    expect(isCtaSurface('organizations')).toBe(true)
    expect(isCtaSurface('pricing')).toBe(true)
    expect(isCtaSurface('nope')).toBe(false)
    expect(isCtaSurface(42)).toBe(false)
    expect(isCtaSurface(undefined)).toBe(false)
  })
})
