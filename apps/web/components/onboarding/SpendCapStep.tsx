'use client'

import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  AUTO_RECHARGE_AMOUNT_MAX_DECIMILLICENTS,
  AUTO_RECHARGE_AMOUNT_MIN_DECIMILLICENTS
} from '@tx-agent-kit/contracts'
import {
  getBillingGetBillingSettingsQueryKey,
  useBillingUpdateBillingSettings
} from '@/lib/api/generated/billing/billing'
import { notify } from '@/lib/notify'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  formatUsdFromDecimillicents,
  parseOptionalDollarInput,
  toDollarInput
} from '@/components/billing/billing-utils'

const capOptions = ['50', '100', '250', '500'] as const

type CapSelection = (typeof capOptions)[number] | 'custom' | 'none'

const deriveSelectionFromCap = (value: number | null | undefined): {
  selection: CapSelection
  customValue: string
} => {
  const dollarValue = toDollarInput(value)
  if (dollarValue === '') {
    return { selection: '100', customValue: '' }
  }

  if (capOptions.includes(dollarValue as (typeof capOptions)[number])) {
    return {
      selection: dollarValue as (typeof capOptions)[number],
      customValue: ''
    }
  }

  return {
    selection: 'custom',
    customValue: dollarValue
  }
}

export interface SpendCapStepProps {
  readonly organizationId: string
  readonly initialUsageCapDecimillicents?: number | null
  readonly onContinue: () => Promise<void> | void
  readonly onBack?: () => void
}

export function SpendCapStep({
  organizationId,
  initialUsageCapDecimillicents = null,
  onContinue,
  onBack
}: SpendCapStepProps): React.ReactElement {
  const queryClient = useQueryClient()
  const seededOrgIdRef = useRef<string | null>(null)
  const [selection, setSelection] = useState<CapSelection>('100')
  const [customValue, setCustomValue] = useState('')

  useEffect(() => {
    if (seededOrgIdRef.current === organizationId) {
      return
    }

    const derived = deriveSelectionFromCap(initialUsageCapDecimillicents)
    setSelection(derived.selection)
    setCustomValue(derived.customValue)
    seededOrgIdRef.current = organizationId
  }, [initialUsageCapDecimillicents, organizationId])

  const updateMutation = useBillingUpdateBillingSettings({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: getBillingGetBillingSettingsQueryKey(organizationId)
        })
      },
      onError: () => {
        notify.error('Failed to save spend cap')
      }
    }
  })

  const resolveCapValue = (): number | null => {
    if (selection === 'none') {
      return null
    }

    const rawValue = selection === 'custom' ? customValue : selection
    const parsed = parseOptionalDollarInput(rawValue)

    if (!parsed.ok || parsed.value === null) {
      throw new Error('Enter a valid spend cap amount')
    }

    if (
      parsed.value < AUTO_RECHARGE_AMOUNT_MIN_DECIMILLICENTS
      || parsed.value > AUTO_RECHARGE_AMOUNT_MAX_DECIMILLICENTS
    ) {
      throw new Error(
        `Spend cap must be between ${formatUsdFromDecimillicents(AUTO_RECHARGE_AMOUNT_MIN_DECIMILLICENTS)} and ${formatUsdFromDecimillicents(AUTO_RECHARGE_AMOUNT_MAX_DECIMILLICENTS)}`
      )
    }

    return parsed.value
  }

  const setCapAndContinue = async () => {
    try {
      const usageCapDecimillicents = resolveCapValue()

      await updateMutation.mutateAsync({
        organizationId,
        data: { usageCapDecimillicents }
      })

      await onContinue()
      notify.success('Spend cap saved')
    } catch (error) {
      notify.apiError(error, 'Failed to save spend cap')
    }
  }

  const skip = async () => {
    try {
      await updateMutation.mutateAsync({
        organizationId,
        data: { usageCapDecimillicents: null }
      })

      await onContinue()
    } catch {
      // handled in mutation callback
    }
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Set a monthly spend cap (optional)</h2>
        <p className="text-sm text-muted-foreground">
          We&apos;ll stop AI operations if your spending hits this cap. You can change or remove it anytime in billing settings.
        </p>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Spend cap presets">
        {capOptions.map((option) => (
          <Button
            key={option}
            type="button"
            variant={selection === option ? 'default' : 'outline'}
            onClick={() => setSelection(option)}
          >
            ${option}
          </Button>
        ))}
        <Button
          type="button"
          variant={selection === 'custom' ? 'default' : 'outline'}
          onClick={() => setSelection('custom')}
        >
          Custom
        </Button>
        <Button
          type="button"
          variant={selection === 'none' ? 'default' : 'outline'}
          onClick={() => {
            setSelection('none')
            setCustomValue('')
          }}
        >
          No cap
        </Button>
      </div>

      {selection === 'custom' ? (
        <div className="space-y-2">
          <label htmlFor="onboarding-spend-cap-custom" className="text-sm font-medium">
            Custom monthly cap (USD)
          </label>
          <Input
            id="onboarding-spend-cap-custom"
            inputMode="decimal"
            value={customValue}
            onChange={(event) => setCustomValue(event.target.value)}
            placeholder="100"
          />
        </div>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        {onBack ? (
          <Button type="button" variant="outline" onClick={onBack} disabled={updateMutation.isPending}>
            Back
          </Button>
        ) : null}
        <Button type="button" onClick={() => { void setCapAndContinue() }} disabled={updateMutation.isPending}>
          {updateMutation.isPending ? 'Saving...' : 'Set cap and continue'}
        </Button>
        <Button type="button" variant="ghost" onClick={() => { void skip() }} disabled={updateMutation.isPending}>
          Skip for now
        </Button>
      </div>
    </div>
  )
}
