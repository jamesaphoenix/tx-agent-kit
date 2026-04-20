/**
 * Shared formatting helpers for the billing UI. Centralised so plan
 * cards, credit history rows, usage breakdown totals, and the top-up
 * dialog all agree on how dollars look.
 */

const DECIMILLICENTS_PER_DOLLAR = 10_000_000

export interface FormatUsdOptions {
  readonly minimumFractionDigits?: number
  readonly maximumFractionDigits?: number
}

export const formatUsdFromDecimillicents = (
  decimillicents: number,
  options: FormatUsdOptions = {}
): string => {
  const dollars = decimillicents / DECIMILLICENTS_PER_DOLLAR
  return dollars.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: options.minimumFractionDigits ?? 2,
    maximumFractionDigits: options.maximumFractionDigits ?? 2
  })
}

export const formatUsdFromCents = (
  cents: number,
  options: FormatUsdOptions = {}
): string => {
  const dollars = cents / 100
  return dollars.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: options.minimumFractionDigits ?? 0,
    maximumFractionDigits: options.maximumFractionDigits ?? 0
  })
}

export const formatDateTime = (iso: string): string => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return iso
  }
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}
