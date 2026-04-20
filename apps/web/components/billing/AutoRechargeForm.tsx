'use client'

import { useEffect, useRef, useState } from 'react'
import type { BillingGetBillingSettings200 } from '@/lib/api/generated/schemas'
import { useQueryClient } from '@tanstack/react-query'
import {
  AUTO_RECHARGE_AMOUNT_MAX_DECIMILLICENTS,
  AUTO_RECHARGE_AMOUNT_MIN_DECIMILLICENTS,
  AUTO_RECHARGE_THRESHOLD_MAX_DECIMILLICENTS,
  AUTO_RECHARGE_THRESHOLD_MIN_DECIMILLICENTS
} from '@tx-agent-kit/contracts'
import {
  getBillingGetBillingSettingsQueryKey,
  useBillingUpdateBillingSettings
} from '@/lib/api/generated/billing/billing'
import { notify } from '@/lib/notify'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  formatUsdFromDecimillicents,
  parseOptionalDollarInput,
  toDollarInput
} from './billing-utils'

export interface AutoRechargeFormProps {
  readonly organizationId: string
  readonly settings: BillingGetBillingSettings200
}

export function AutoRechargeForm({
  organizationId,
  settings
}: AutoRechargeFormProps): React.ReactElement {
  const queryClient = useQueryClient()
  const seededOrgIdRef = useRef<string | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [threshold, setThreshold] = useState('')
  const [amount, setAmount] = useState('')

  useEffect(() => {
    if (seededOrgIdRef.current === settings.organizationId) {
      return
    }

    setEnabled(settings.autoRechargeEnabled)
    setThreshold(toDollarInput(settings.autoRechargeThresholdDecimillicents))
    setAmount(toDollarInput(settings.autoRechargeAmountDecimillicents))
    seededOrgIdRef.current = settings.organizationId
  }, [settings])

  const updateMutation = useBillingUpdateBillingSettings({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: getBillingGetBillingSettingsQueryKey(organizationId)
        })
        notify.success('Auto-recharge settings saved')
      },
      onError: () => {
        notify.error('Failed to save auto-recharge settings')
      }
    }
  })

  const handleSave = async () => {
    const parsedThreshold = parseOptionalDollarInput(threshold)
    const parsedAmount = parseOptionalDollarInput(amount)

    if (!parsedThreshold.ok || !parsedAmount.ok) {
      notify.error('Enter valid dollar amounts for auto-recharge')
      return
    }

    if (enabled && (parsedThreshold.value === null || parsedAmount.value === null)) {
      notify.error('Auto-recharge requires both a threshold and an amount')
      return
    }

    if (
      parsedThreshold.value !== null
      && (
        parsedThreshold.value < AUTO_RECHARGE_THRESHOLD_MIN_DECIMILLICENTS
        || parsedThreshold.value > AUTO_RECHARGE_THRESHOLD_MAX_DECIMILLICENTS
      )
    ) {
      notify.error(
        `Threshold must be between ${formatUsdFromDecimillicents(AUTO_RECHARGE_THRESHOLD_MIN_DECIMILLICENTS)} and ${formatUsdFromDecimillicents(AUTO_RECHARGE_THRESHOLD_MAX_DECIMILLICENTS)}`
      )
      return
    }

    if (
      parsedAmount.value !== null
      && (
        parsedAmount.value < AUTO_RECHARGE_AMOUNT_MIN_DECIMILLICENTS
        || parsedAmount.value > AUTO_RECHARGE_AMOUNT_MAX_DECIMILLICENTS
      )
    ) {
      notify.error(
        `Amount must be between ${formatUsdFromDecimillicents(AUTO_RECHARGE_AMOUNT_MIN_DECIMILLICENTS)} and ${formatUsdFromDecimillicents(AUTO_RECHARGE_AMOUNT_MAX_DECIMILLICENTS)}`
      )
      return
    }

    try {
      await updateMutation.mutateAsync({
        organizationId,
        data: {
          autoRechargeEnabled: enabled,
          autoRechargeThresholdDecimillicents: parsedThreshold.value,
          autoRechargeAmountDecimillicents: parsedAmount.value
        }
      })
    } catch {
      // handled by mutation callback
    }
  }

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle>Auto-recharge</CardTitle>
        <CardDescription>
          Refill credits automatically before workflows stall on a low balance.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2 sm:col-span-2">
          <Label htmlFor="auto-recharge-enabled">Status</Label>
          <div className="flex flex-col gap-3 rounded-md border px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-sm text-muted-foreground">
              When enabled, tx-agent-kit tops up credits once the available balance falls below the threshold.
            </span>
            <div id="auto-recharge-enabled" className="flex gap-2" role="group" aria-label="Auto-recharge">
              <Button
                type="button"
                size="sm"
                variant={enabled ? 'default' : 'outline'}
                onClick={() => setEnabled(true)}
              >
                Enabled
              </Button>
              <Button
                type="button"
                size="sm"
                variant={!enabled ? 'default' : 'outline'}
                onClick={() => setEnabled(false)}
              >
                Disabled
              </Button>
            </div>
          </div>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="auto-recharge-threshold">Threshold (USD)</Label>
          <Input
            id="auto-recharge-threshold"
            inputMode="decimal"
            placeholder="5"
            value={threshold}
            onChange={(event) => setThreshold(event.target.value)}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="auto-recharge-amount">Recharge amount (USD)</Label>
          <Input
            id="auto-recharge-amount"
            inputMode="decimal"
            placeholder="25"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </div>
      </CardContent>
      <CardFooter className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Badge variant={enabled ? 'secondary' : 'outline'}>
          {enabled ? 'Auto-recharge enabled' : 'Auto-recharge disabled'}
        </Badge>
        <Button
          type="button"
          onClick={() => { void handleSave() }}
          disabled={updateMutation.isPending}
        >
          {updateMutation.isPending ? 'Saving...' : 'Save auto-recharge'}
        </Button>
      </CardFooter>
    </Card>
  )
}
