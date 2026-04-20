'use client'

import { useEffect, useState } from 'react'
import { TOP_UP_MAX_DECIMILLICENTS, TOP_UP_MIN_DECIMILLICENTS } from '@tx-agent-kit/contracts'
import { useBillingCreateTopUpSession } from '@/lib/api/generated/billing/billing'
import { notify } from '@/lib/notify'
import { readBrowserLocationState } from '@/lib/url-state'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  formatUsdFromDecimillicents,
  navigateToBillingUrl,
  parseOptionalDollarInput
} from './billing-utils'

export interface TopUpDialogProps {
  readonly organizationId: string
  readonly defaultAmountDollars?: string
}

const presetAmounts = ['10', '25', '100', '250'] as const

export function TopUpDialog({
  organizationId,
  defaultAmountDollars = '25'
}: TopUpDialogProps): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [amountDollars, setAmountDollars] = useState(defaultAmountDollars)
  const [pendingAmountDecimillicents, setPendingAmountDecimillicents] = useState<number | null>(null)

  useEffect(() => {
    if (open) {
      setAmountDollars(defaultAmountDollars)
      setPendingAmountDecimillicents(null)
    }
  }, [defaultAmountDollars, open])

  const topUpMutation = useBillingCreateTopUpSession({
    mutation: {
      onError: () => {
        notify.error('Failed to create top-up session')
      }
    }
  })

  const validateAmount = (): number | null => {
    const parsed = parseOptionalDollarInput(amountDollars)
    if (!parsed.ok || parsed.value === null) {
      notify.error('Enter a valid top-up amount in dollars')
      return null
    }

    if (
      parsed.value < TOP_UP_MIN_DECIMILLICENTS
      || parsed.value > TOP_UP_MAX_DECIMILLICENTS
    ) {
      notify.error(
        `Top-ups must be between ${formatUsdFromDecimillicents(TOP_UP_MIN_DECIMILLICENTS)} and ${formatUsdFromDecimillicents(TOP_UP_MAX_DECIMILLICENTS)}`
      )
      return null
    }

    return parsed.value
  }

  const beginConfirmation = () => {
    const validatedAmount = validateAmount()
    if (validatedAmount === null) {
      return
    }

    setPendingAmountDecimillicents(validatedAmount)
  }

  const launchTopUp = async () => {
    if (pendingAmountDecimillicents === null) {
      return
    }

    try {
      const origin = readBrowserLocationState().origin
      const session = await topUpMutation.mutateAsync({
        organizationId,
        data: {
          amountDecimillicents: pendingAmountDecimillicents,
          successUrl: `${origin}/org/${organizationId}/billing`,
          cancelUrl: `${origin}/org/${organizationId}/billing`
        }
      })
      navigateToBillingUrl(session.url)
    } catch {
      // handled by mutation callback
    }
  }

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        Top up credits
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          {pendingAmountDecimillicents === null ? (
            <>
              <DialogHeader>
                <DialogTitle>Top up credits</DialogTitle>
                <DialogDescription>
                  Buy a one-time credit bundle through Stripe Checkout.
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-4">
                <div className="flex flex-wrap gap-2">
                  {presetAmounts.map((preset) => (
                    <Button
                      key={preset}
                      type="button"
                      variant={amountDollars === preset ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setAmountDollars(preset)}
                    >
                      ${preset}
                    </Button>
                  ))}
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="billing-top-up-amount">Amount (USD)</Label>
                  <Input
                    id="billing-top-up-amount"
                    inputMode="decimal"
                    value={amountDollars}
                    onChange={(event) => setAmountDollars(event.target.value)}
                    placeholder="25"
                  />
                </div>
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={beginConfirmation}
                  disabled={topUpMutation.isPending}
                >
                  Continue to Stripe
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Confirm credit top-up</DialogTitle>
                <DialogDescription>
                  You are about to purchase {formatUsdFromDecimillicents(pendingAmountDecimillicents)} in credits.
                </DialogDescription>
              </DialogHeader>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPendingAmountDecimillicents(null)}
                >
                  Back
                </Button>
                <Button
                  type="button"
                  onClick={() => { void launchTopUp() }}
                  disabled={topUpMutation.isPending}
                >
                  {topUpMutation.isPending ? 'Opening Stripe...' : 'Confirm top-up'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
