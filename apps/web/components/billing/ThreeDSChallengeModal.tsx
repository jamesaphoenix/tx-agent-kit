'use client'

import { useState } from 'react'
import { notify } from '@/lib/notify'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'

declare global {
  interface Window {
    Stripe?: (publishableKey: string) => {
      confirmCardPayment: (
        clientSecret: string
      ) => Promise<{ error?: { message?: string } }>
    }
  }
}

export interface ThreeDSChallengeModalProps {
  readonly open: boolean
  readonly clientSecret: string | null
  readonly stripePublishableKey?: string | null
  readonly publishableKey?: string | null
  readonly confirmPayment?: (
    clientSecret: string
  ) => Promise<{ status: 'succeeded' | 'failed'; error?: string }>
  readonly onOpenChange: (open: boolean) => void
  readonly onSucceeded?: () => void
}

const ensureStripeJs = async (): Promise<void> => {
  if (window.Stripe) {
    return
  }

  await new Promise<void>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>('script[data-stripe-js]')
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(), { once: true })
      existingScript.addEventListener('error', () => reject(new Error('Failed to load Stripe.js')), { once: true })
      return
    }

    const script = document.createElement('script')
    script.src = 'https://js.stripe.com/v3'
    script.async = true
    script.dataset.stripeJs = 'true'
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Failed to load Stripe.js'))
    document.head.appendChild(script)
  })
}

export function ThreeDSChallengeModal({
  open,
  clientSecret,
  stripePublishableKey,
  publishableKey,
  confirmPayment,
  onOpenChange,
  onSucceeded
}: ThreeDSChallengeModalProps): React.ReactElement {
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirmChallenge = async () => {
    if (!clientSecret) {
      notify.error('Stripe 3DS is not configured in this environment')
      return
    }

    setError(null)

    const resolvedPublishableKey = stripePublishableKey ?? publishableKey ?? null
    if (!confirmPayment && !resolvedPublishableKey) {
      notify.error('Stripe 3DS is not configured in this environment')
      return
    }

    setConfirming(true)

    try {
      if (confirmPayment) {
        const result = await confirmPayment(clientSecret)
        if (result.status === 'failed') {
          setError(result.error ?? 'Authentication failed')
          return
        }
      } else {
        if (!resolvedPublishableKey) {
          notify.error('Stripe 3DS is not configured in this environment')
          return
        }

        await ensureStripeJs()
        const stripe = window.Stripe?.(resolvedPublishableKey)
        if (!stripe) {
          notify.error('Failed to initialize Stripe.js')
          return
        }

        const result = await stripe.confirmCardPayment(clientSecret)
        if (result.error) {
          setError(result.error.message ?? '3DS authentication failed')
          return
        }
      }

      notify.success('Card authentication complete')
      onOpenChange(false)
      onSucceeded?.()
    } catch {
      setError('Failed to load the bank authentication challenge')
    } finally {
      setConfirming(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Complete bank authentication</DialogTitle>
          <DialogDescription>
            Your bank requires an extra verification step before credits can be recharged.
          </DialogDescription>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Continue to load the Stripe 3DS challenge. If the bank prompt fails, you can retry from this dialog.
        </p>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            type="button"
            onClick={() => { void confirmChallenge() }}
            disabled={confirming || !clientSecret}
          >
            {confirming ? 'Verifying...' : 'Continue authentication'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
