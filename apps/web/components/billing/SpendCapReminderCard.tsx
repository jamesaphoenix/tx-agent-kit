'use client'

import * as React from 'react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  useBillingGetBillingSettings,
  useBillingUpdateBillingSettings
} from '@/lib/api/generated/billing/billing'
import { getApiErrorMessage } from '@/lib/axios'

/**
 * Onboarding reminder card that nudges new orgs to set a monthly
 * spend cap. Visible on the billing overview page only when
 * `usageCapDecimillicents` is null. A dismiss button hides the card
 * client-side for the current session (we intentionally don't
 * persist dismissal — the next reload re-prompts until a cap is set).
 *
 * Saves go through the same `useBillingUpdateBillingSettings` mutation
 * the Slice 11 settings form uses, and the cap is stored in
 * decimillicents on `organizations.usage_cap`.
 *
 * @spec billing-and-pricing-design §"Onboarding" — spend cap opt-in
 */
export interface SpendCapReminderCardProps {
  readonly organizationId: string
}

const DECIMILLICENTS_PER_DOLLAR = 10_000_000

const PRESET_AMOUNTS_USD: ReadonlyArray<number> = [50, 200, 500]

const toDecimillicents = (dollars: number): number =>
  Math.round(dollars * DECIMILLICENTS_PER_DOLLAR)

const parseCustomAmount = (raw: string): number | null => {
  const trimmed = raw.trim()
  if (trimmed === '') {
    return null
  }
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null
  }
  return parsed
}

export function SpendCapReminderCard({
  organizationId
}: SpendCapReminderCardProps): React.ReactElement | null {
  const settingsQuery = useBillingGetBillingSettings(organizationId)
  const updateSettings = useBillingUpdateBillingSettings()
  const [selectedPreset, setSelectedPreset] = React.useState<number | null>(200)
  const [customAmount, setCustomAmount] = React.useState<string>('')
  const [dismissed, setDismissed] = React.useState<boolean>(false)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null)

  const usageCap = settingsQuery.data?.usageCapDecimillicents ?? null
  const hasCapAlready = usageCap !== null && usageCap > 0

  if (settingsQuery.isPending) {
    return null
  }
  if (hasCapAlready) {
    return null
  }
  if (dismissed) {
    return null
  }

  const customValue = parseCustomAmount(customAmount)
  const selectedDollars: number | null = customValue ?? selectedPreset

  const handleSelectPreset = (dollars: number): void => {
    setSelectedPreset(dollars)
    setCustomAmount('')
    setErrorMessage(null)
    setSuccessMessage(null)
  }

  const handleCustomChange = (value: string): void => {
    setCustomAmount(value)
    if (value.trim() !== '') {
      setSelectedPreset(null)
    }
    setErrorMessage(null)
    setSuccessMessage(null)
  }

  const handleSave = async (): Promise<void> => {
    setErrorMessage(null)
    setSuccessMessage(null)
    if (selectedDollars === null || selectedDollars <= 0) {
      setErrorMessage('Pick a preset or enter a positive custom amount.')
      return
    }
    try {
      await updateSettings.mutateAsync({
        organizationId,
        data: {
          usageCapDecimillicents: toDecimillicents(selectedDollars)
        }
      })
      setSuccessMessage(`Monthly spend cap set to $${selectedDollars.toLocaleString('en-US')}.`)
      await settingsQuery.refetch()
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error, 'Could not save spend cap.'))
    }
  }

  return (
    <Card data-testid="spend-cap-reminder-card" className="border-primary/40">
      <CardHeader>
        <CardTitle>Set a monthly spend cap</CardTitle>
        <CardDescription>
          Protect your wallet from surprise bills. When you reach the cap
          we pause billable operations until the next billing cycle. You
          can change or remove it any time from billing settings.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          {PRESET_AMOUNTS_USD.map((amount) => {
            const isActive = selectedPreset === amount && customAmount.trim() === ''
            return (
              <Button
                key={amount}
                type="button"
                variant={isActive ? 'default' : 'outline'}
                className="btn"
                onClick={() => handleSelectPreset(amount)}
                data-testid={`spend-cap-preset-${amount}`}
              >
                ${amount}/month
              </Button>
            )
          })}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="spend-cap-custom">Custom monthly cap (USD)</Label>
          <Input
            id="spend-cap-custom"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            placeholder="e.g. 125"
            value={customAmount}
            onChange={(event) => handleCustomChange(event.target.value)}
            data-testid="spend-cap-custom-input"
          />
        </div>

        {errorMessage ? (
          <div
            role="alert"
            className="rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-900"
          >
            {errorMessage}
          </div>
        ) : null}
        {successMessage ? (
          <div
            role="status"
            className="rounded-md border border-emerald-300 bg-emerald-50 p-2 text-xs text-emerald-900"
          >
            {successMessage}
          </div>
        ) : null}
      </CardContent>

      <CardFooter className="flex justify-between">
        <Button
          type="button"
          variant="outline"
          className="btn secondary"
          onClick={() => setDismissed(true)}
          data-testid="spend-cap-dismiss"
        >
          Dismiss for now
        </Button>
        <Button
          type="button"
          className="btn"
          disabled={updateSettings.isPending || selectedDollars === null}
          onClick={() => {
            void handleSave()
          }}
          data-testid="spend-cap-save"
        >
          {updateSettings.isPending ? 'Saving…' : 'Set spend cap'}
        </Button>
      </CardFooter>
    </Card>
  )
}
