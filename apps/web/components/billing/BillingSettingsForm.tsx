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
  useBillingCreatePortalSession,
  useBillingGetBillingSettings,
  useBillingUpdateBillingSettings
} from '@/lib/api/generated/billing/billing'
import type { BillingGetBillingSettings200 } from '@/lib/api/generated/schemas/billingGetBillingSettings200'
import type { BillingUpdateBillingSettingsBody } from '@/lib/api/generated/schemas/billingUpdateBillingSettingsBody'
import { getApiErrorMessage } from '@/lib/axios'
import { formatUsdFromDecimillicents } from '@/lib/billing-format'
import { navigateToExternalUrl, readBrowserLocationState } from '@/lib/url-state'

/**
 * Billing settings form. Reads `useBillingGetBillingSettings` for the
 * initial values, wires dollar-denominated inputs to the auto-recharge
 * threshold + top-up amount + optional monthly spend cap fields, and
 * saves via `useBillingUpdateBillingSettings`. A second card exposes a
 * "Manage billing in Stripe" button that hits
 * `useBillingCreatePortalSession` and redirects the tab through the
 * `navigateToExternalUrl` helper from `@/lib/url-state`.
 *
 * All monetary values are displayed/edited as whole dollars and
 * converted at the seam to decimillicents (the contract unit).
 *
 * @spec billing-and-pricing-design §"UI Surfaces" — billing settings
 */
export interface BillingSettingsFormProps {
  readonly organizationId: string
}

const DECIMILLICENTS_PER_DOLLAR = 10_000_000

const toDollars = (decimillicents: number | null | undefined): string => {
  if (decimillicents === null || decimillicents === undefined) {
    return ''
  }
  return (decimillicents / DECIMILLICENTS_PER_DOLLAR).toString()
}

const toDecimillicents = (dollars: string): number | null => {
  const trimmed = dollars.trim()
  if (trimmed === '') {
    return null
  }
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed)) {
    return null
  }
  return Math.round(parsed * DECIMILLICENTS_PER_DOLLAR)
}

interface FormState {
  readonly autoRechargeEnabled: boolean
  readonly autoRechargeThresholdDollars: string
  readonly autoRechargeAmountDollars: string
  readonly usageCapDollars: string
}

const stateFromSettings = (settings: BillingGetBillingSettings200): FormState => ({
  autoRechargeEnabled: settings.autoRechargeEnabled,
  autoRechargeThresholdDollars: toDollars(settings.autoRechargeThresholdDecimillicents),
  autoRechargeAmountDollars: toDollars(settings.autoRechargeAmountDecimillicents),
  usageCapDollars: toDollars(settings.usageCapDecimillicents)
})

const PLAN_LABEL: Record<'try_me' | 'pro' | 'agency', string> = {
  try_me: 'Try Me',
  pro: 'Pro',
  agency: 'Agency'
}

export function BillingSettingsForm({
  organizationId
}: BillingSettingsFormProps): React.ReactElement {
  const settingsQuery = useBillingGetBillingSettings(organizationId)
  const updateSettings = useBillingUpdateBillingSettings()
  const createPortal = useBillingCreatePortalSession()

  const [formState, setFormState] = React.useState<FormState | null>(null)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const [saveMessage, setSaveMessage] = React.useState<string | null>(null)
  const [portalErrorMessage, setPortalErrorMessage] = React.useState<string | null>(null)
  const [isSaving, setIsSaving] = React.useState<boolean>(false)
  const lastSeenSettingsId = React.useRef<string | null>(null)

  React.useEffect(() => {
    const settings = settingsQuery.data
    if (!settings) {
      return
    }
    // Only reset the form when a new server payload lands, not on every
    // re-render. We key on a hash of the server fields the form cares
    // about so local edits aren't clobbered.
    const fingerprint = [
      settings.autoRechargeEnabled,
      settings.autoRechargeThresholdDecimillicents ?? '',
      settings.autoRechargeAmountDecimillicents ?? '',
      settings.usageCapDecimillicents ?? ''
    ].join('|')
    if (lastSeenSettingsId.current === fingerprint) {
      return
    }
    lastSeenSettingsId.current = fingerprint
    setFormState(stateFromSettings(settings))
  }, [settingsQuery.data])

  const settings = settingsQuery.data ?? null

  const handleToggleAutoRecharge = (): void => {
    setFormState((prev) =>
      prev === null ? prev : { ...prev, autoRechargeEnabled: !prev.autoRechargeEnabled }
    )
    setSaveMessage(null)
  }

  const handleFieldChange = (field: keyof Omit<FormState, 'autoRechargeEnabled'>, value: string): void => {
    setFormState((prev) => (prev === null ? prev : { ...prev, [field]: value }))
    setSaveMessage(null)
  }

  const handleSave = async (): Promise<void> => {
    if (formState === null) {
      return
    }
    setErrorMessage(null)
    setSaveMessage(null)

    const thresholdDecimillicents = toDecimillicents(formState.autoRechargeThresholdDollars)
    const amountDecimillicents = toDecimillicents(formState.autoRechargeAmountDollars)
    const usageCapDecimillicents = toDecimillicents(formState.usageCapDollars)

    const hasNegative =
      (thresholdDecimillicents !== null && thresholdDecimillicents < 0) ||
      (amountDecimillicents !== null && amountDecimillicents < 0) ||
      (usageCapDecimillicents !== null && usageCapDecimillicents < 0)

    if (hasNegative) {
      setErrorMessage('Threshold and top-up amount must be positive numbers.')
      return
    }

    if (
      formState.autoRechargeEnabled &&
      (thresholdDecimillicents === null || amountDecimillicents === null)
    ) {
      setErrorMessage('Threshold and top-up amount must be positive numbers.')
      return
    }

    const body: BillingUpdateBillingSettingsBody = {
      autoRechargeEnabled: formState.autoRechargeEnabled,
      autoRechargeThresholdDecimillicents: thresholdDecimillicents,
      autoRechargeAmountDecimillicents: amountDecimillicents,
      usageCapDecimillicents
    }

    setIsSaving(true)
    try {
      await updateSettings.mutateAsync({ organizationId, data: body })
      setSaveMessage('Settings saved.')
      await settingsQuery.refetch()
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error, 'Could not save billing settings.'))
    } finally {
      setIsSaving(false)
    }
  }

  const handleOpenPortal = async (): Promise<void> => {
    setPortalErrorMessage(null)
    const { origin } = readBrowserLocationState()
    try {
      const session = await createPortal.mutateAsync({
        data: {
          organizationId,
          returnUrl: `${origin}/org/${organizationId}/billing/settings`
        }
      })
      if (session.url) {
        navigateToExternalUrl(session.url)
      }
    } catch (error) {
      setPortalErrorMessage(getApiErrorMessage(error, 'Could not open Stripe portal.'))
    }
  }

  if (settingsQuery.isPending && formState === null) {
    return (
      <Card data-testid="billing-settings-loading">
        <CardHeader>
          <CardTitle>Billing settings</CardTitle>
          <CardDescription>Loading your auto-recharge and spend cap preferences…</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (settingsQuery.isError && formState === null) {
    return (
      <Card data-testid="billing-settings-error">
        <CardHeader>
          <CardTitle>Billing settings</CardTitle>
          <CardDescription>
            {getApiErrorMessage(settingsQuery.error, 'Could not load billing settings.')}
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (formState === null) {
    return <Card data-testid="billing-settings-empty" />
  }

  const planLabel = settings?.subscriptionPlan ? PLAN_LABEL[settings.subscriptionPlan] : 'No active plan'
  const balanceLabel = settings
    ? formatUsdFromDecimillicents(settings.creditsBalanceDecimillicents)
    : '—'

  return (
    <div className="flex flex-col gap-4" data-testid="billing-settings-form">
      <Card>
        <CardHeader>
          <CardTitle>Current plan</CardTitle>
          <CardDescription>
            Active plan and wallet balance. Manage your subscription in Stripe.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Plan</span>
            <span className="font-medium" data-testid="billing-settings-plan">{planLabel}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Wallet balance</span>
            <span className="font-medium" data-testid="billing-settings-balance">{balanceLabel}</span>
          </div>
          {portalErrorMessage ? (
            <div
              role="alert"
              className="rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-900"
            >
              {portalErrorMessage}
            </div>
          ) : null}
        </CardContent>
        <CardFooter>
          <Button
            type="button"
            variant="outline"
            className="btn secondary"
            disabled={createPortal.isPending}
            onClick={() => {
              void handleOpenPortal()
            }}
          >
            {createPortal.isPending ? 'Opening…' : 'Manage billing in Stripe'}
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Auto-recharge</CardTitle>
          <CardDescription>
            When your wallet drops below the threshold we top it up automatically
            using your saved Stripe card.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="auto-recharge-enabled" className="text-sm">
              Enable auto-recharge
            </Label>
            <input
              id="auto-recharge-enabled"
              type="checkbox"
              role="switch"
              checked={formState.autoRechargeEnabled}
              onChange={handleToggleAutoRecharge}
              data-testid="billing-settings-auto-recharge-toggle"
              className="h-4 w-4 rounded border border-input"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="auto-recharge-threshold">Threshold (USD)</Label>
            <Input
              id="auto-recharge-threshold"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              placeholder="e.g. 10"
              value={formState.autoRechargeThresholdDollars}
              onChange={(event) => handleFieldChange('autoRechargeThresholdDollars', event.target.value)}
              disabled={!formState.autoRechargeEnabled}
              data-testid="billing-settings-threshold"
            />
            <p className="text-xs text-muted-foreground">
              Auto-recharge kicks in when your wallet balance falls below this
              amount.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="auto-recharge-amount">Top-up amount (USD)</Label>
            <Input
              id="auto-recharge-amount"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              placeholder="e.g. 50"
              value={formState.autoRechargeAmountDollars}
              onChange={(event) => handleFieldChange('autoRechargeAmountDollars', event.target.value)}
              disabled={!formState.autoRechargeEnabled}
              data-testid="billing-settings-amount"
            />
            <p className="text-xs text-muted-foreground">
              How much we charge each time auto-recharge fires. Between $0.01 and $500.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Monthly spend cap</CardTitle>
          <CardDescription>
            Optional hard ceiling on monthly credit consumption. We suspend
            billable operations when the cap is reached.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-2">
            <Label htmlFor="usage-cap">Spend cap (USD)</Label>
            <Input
              id="usage-cap"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              placeholder="Leave blank for no cap"
              value={formState.usageCapDollars}
              onChange={(event) => handleFieldChange('usageCapDollars', event.target.value)}
              data-testid="billing-settings-usage-cap"
            />
          </div>
        </CardContent>
      </Card>

      {errorMessage ? (
        <div
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900"
        >
          {errorMessage}
        </div>
      ) : null}
      {saveMessage ? (
        <div
          role="status"
          className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900"
        >
          {saveMessage}
        </div>
      ) : null}

      <div className="flex justify-end">
        <Button
          type="button"
          className="btn"
          disabled={isSaving || updateSettings.isPending}
          onClick={() => {
            void handleSave()
          }}
          data-testid="billing-settings-save"
        >
          {isSaving || updateSettings.isPending ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </div>
  )
}
