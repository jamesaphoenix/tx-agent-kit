'use client'

import { useEffect, useRef, useState } from 'react'
import type { BillingGetBillingSettings200 } from '@/lib/api/generated/schemas'
import { useQueryClient } from '@tanstack/react-query'
import { getBillingGetBillingSettingsQueryKey, useBillingUpdateBillingSettings } from '@/lib/api/generated/billing/billing'
import { notify } from '@/lib/notify'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  formatUsdFromDecimillicents,
  parseOptionalDollarInput,
  toDollarInput
} from './billing-utils'

const spendCapPresetDollars = [50, 100, 250, 500] as const

export interface SpendCapFormProps {
  readonly organizationId: string
  readonly settings: BillingGetBillingSettings200
}

const resolveInitialMode = (usageCapDecimillicents: number | null): 'none' | 'preset' | 'custom' => {
  if (usageCapDecimillicents === null) {
    return 'none'
  }

  const presetMatch = spendCapPresetDollars.some(
    (preset) => toDollarInput(usageCapDecimillicents) === preset.toString()
  )

  return presetMatch ? 'preset' : 'custom'
}

export function SpendCapForm({
  organizationId,
  settings
}: SpendCapFormProps): React.ReactElement {
  const queryClient = useQueryClient()
  const seededOrgIdRef = useRef<string | null>(null)
  const [mode, setMode] = useState<'none' | 'preset' | 'custom'>('none')
  const [amount, setAmount] = useState('')

  useEffect(() => {
    if (seededOrgIdRef.current === settings.organizationId) {
      return
    }

    setMode(resolveInitialMode(settings.usageCapDecimillicents))
    setAmount(toDollarInput(settings.usageCapDecimillicents))
    seededOrgIdRef.current = settings.organizationId
  }, [settings])

  const updateMutation = useBillingUpdateBillingSettings({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: getBillingGetBillingSettingsQueryKey(organizationId)
        })
        notify.success('Spend cap saved')
      },
      onError: () => {
        notify.error('Failed to save spend cap')
      }
    }
  })

  const handleSave = async () => {
    const parsed = parseOptionalDollarInput(amount)
    if (!parsed.ok) {
      notify.error('Enter a valid dollar amount for the spend cap')
      return
    }

    const usageCapDecimillicents = mode === 'none' ? null : parsed.value
    if (mode !== 'none' && usageCapDecimillicents === null) {
      notify.error('Choose a spend cap or select No cap')
      return
    }

    try {
      await updateMutation.mutateAsync({
        organizationId,
        data: {
          usageCapDecimillicents
        }
      })
    } catch {
      // handled by mutation callback
    }
  }

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle>Monthly spend cap</CardTitle>
        <CardDescription>
          Optional guardrail. AI operations pause when spending reaches this cap.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap gap-2">
          {spendCapPresetDollars.map((preset) => (
            <Button
              key={preset}
              type="button"
              size="sm"
              variant={mode !== 'none' && amount === preset.toString() ? 'default' : 'outline'}
              onClick={() => {
                setMode('preset')
                setAmount(preset.toString())
              }}
            >
              ${preset}
            </Button>
          ))}
          <Button
            type="button"
            size="sm"
            variant={mode === 'custom' ? 'default' : 'outline'}
            onClick={() => setMode('custom')}
          >
            Custom
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === 'none' ? 'default' : 'outline'}
            onClick={() => {
              setMode('none')
              setAmount('')
            }}
          >
            No cap
          </Button>
        </div>

        {mode !== 'none' ? (
          <div className="grid gap-2">
            <Label htmlFor="usage-cap">Monthly spend cap (USD)</Label>
            <Input
              id="usage-cap"
              inputMode="decimal"
              placeholder="100"
              value={amount}
              onChange={(event) => {
                setMode('custom')
                setAmount(event.target.value)
              }}
            />
          </div>
        ) : null}

        <p className="text-sm text-muted-foreground">
          Current cap:{' '}
          {settings.usageCapDecimillicents === null
            ? 'No cap'
            : formatUsdFromDecimillicents(settings.usageCapDecimillicents)}
        </p>
      </CardContent>
      <CardFooter className="justify-end">
        <Button
          type="button"
          onClick={() => { void handleSave() }}
          disabled={updateMutation.isPending}
        >
          {updateMutation.isPending ? 'Saving...' : 'Save spend cap'}
        </Button>
      </CardFooter>
    </Card>
  )
}
