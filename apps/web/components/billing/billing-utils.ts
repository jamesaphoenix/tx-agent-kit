'use client'

import { fromDecimillicents, toDecimillicents } from '@tx-agent-kit/contracts'
import { navigateToExternalUrl, readBrowserLocationState } from '@/lib/url-state'

const moneyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 4
})

export const formatUsdFromDecimillicents = (value: number | null | undefined): string =>
  moneyFormatter.format(fromDecimillicents(value ?? 0))

export const formatUsdFromCents = (value: number | null | undefined): string =>
  moneyFormatter.format((value ?? 0) / 100)

export const toDollarInput = (value: number | null | undefined): string =>
  value === null || value === undefined ? '' : String(fromDecimillicents(value))

export const parseOptionalDollarInput = (
  value: string
): { ok: true; value: number | null } | { ok: false } => {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return { ok: true, value: null }
  }

  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed) || parsed < 0) {
    return { ok: false }
  }

  return {
    ok: true,
    value: toDecimillicents(parsed)
  }
}

export const formatBillingDateTime = (value: string | null | undefined): string => {
  if (!value) {
    return 'Not available'
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return 'Not available'
  }

  return parsed.toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short'
  })
}

export const formatRelativeToNow = (value: string | null | undefined): string => {
  if (!value) {
    return 'soon'
  }

  const parsed = new Date(value).getTime()
  if (Number.isNaN(parsed)) {
    return 'soon'
  }

  const diffMs = parsed - Date.now()
  const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000))
  if (diffDays === 0) {
    return 'today'
  }
  if (diffDays === 1) {
    return 'in 1 day'
  }
  if (diffDays > 1) {
    return `in ${diffDays.toString()} days`
  }
  if (diffDays === -1) {
    return '1 day ago'
  }

  return `${Math.abs(diffDays).toString()} days ago`
}

export const formatBytes = (value: number): string => {
  if (value >= 1024 * 1024 * 1024) {
    return `${(value / (1024 * 1024 * 1024)).toFixed(0)} GB`
  }

  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(0)} MB`
  }

  if (value >= 1024) {
    return `${(value / 1024).toFixed(0)} KB`
  }

  return `${value.toString()} B`
}

interface BillingNavigationLocation {
  readonly origin: string
  assign: (url: string) => void
}

export const navigateToBillingUrl = (
  url: string,
  location?: BillingNavigationLocation
): void => {
  const origin = location?.origin ?? readBrowserLocationState().origin
  const target = new URL(url, origin)
  if (location) {
    location.assign(target.toString())
    return
  }
  navigateToExternalUrl(target.toString())
}

export const startOfMonthDateInput = (reference: Date = new Date()): string => {
  const year = reference.getFullYear()
  const month = String(reference.getMonth() + 1).padStart(2, '0')
  return `${year.toString()}-${month}-01`
}

export const todayDateInput = (reference: Date = new Date()): string => {
  const year = reference.getFullYear()
  const month = String(reference.getMonth() + 1).padStart(2, '0')
  const day = String(reference.getDate()).padStart(2, '0')
  return `${year.toString()}-${month}-${day}`
}

export const dateInputToRangeStartIso = (value: string): string =>
  new Date(`${value}T00:00:00`).toISOString()

export const dateInputToRangeEndIso = (value: string): string =>
  new Date(`${value}T23:59:59.999`).toISOString()
