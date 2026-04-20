'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useMemo, useState, type ReactElement } from 'react'
import { getWebEnv } from '@/lib/env'
import { notify } from '@/lib/notify'
import {
  navigateToExternalUrl,
  readBrowserLocationState,
  resolveBrowserUrl
} from '@/lib/url-state'
import {
  CUSTOM_DEV_UTILS_PASSWORD,
  defaultCustomDevUtilsDraft,
  runCustomDevUtilsFlow,
  type CustomDevUtilsDraft,
  type CustomDevUtilsPresetId,
  type CustomDevUtilsResult
} from '@/lib/dev-utils/custom-dev-utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'

const presets: ReadonlyArray<{
  id: CustomDevUtilsPresetId
  title: string
  description: string
  requiresStripe: boolean
}> = [
  {
    id: 'free-workspace',
    title: 'Fresh free org',
    description: 'Fresh user, org, and workspace with no subscription changes.',
    requiresStripe: false
  },
  {
    id: 'local-pro-credits',
    title: 'Fresh Pro + $20 local credit',
    description: 'Fresh user plus immediate Pro activation and the local welcome credit.',
    requiresStripe: false
  },
  {
    id: 'local-pro-credits-stripe-checkout',
    title: 'Fresh Pro + local credit + Stripe checkout',
    description: 'Fresh user plus local welcome credit, then a handoff into Stripe test checkout.',
    requiresStripe: true
  },
  {
    id: 'stripe-pro-checkout',
    title: 'Fresh Pro + Stripe checkout',
    description: 'Fresh user plus a handoff to Stripe test checkout when backend Stripe keys are configured.',
    requiresStripe: true
  }
] as const

const IconSparkles = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M12 3l1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3z"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M19 3v4M21 5h-4M5 17v4M7 19H3"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

const IconClose = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M6 6l12 12M18 6L6 18"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

const toAppHref = (result: CustomDevUtilsResult): string =>
  `/org/${result.organization.id}/${result.team.id}`

const handoffToCheckout = (router: ReturnType<typeof useRouter>, url: string): void => {
  const currentLocation = readBrowserLocationState()
  const target = resolveBrowserUrl(url)
  const nextHref = `${target.pathname}${target.search}`

  if (target.origin === currentLocation.origin) {
    router.push(nextHref)
    return
  }

  navigateToExternalUrl(url)
}

export function CustomDevUtils(): ReactElement {
  const router = useRouter()
  const queryClient = useQueryClient()
  const webEnv = getWebEnv()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<CustomDevUtilsDraft>(defaultCustomDevUtilsDraft)
  const [lastResult, setLastResult] = useState<CustomDevUtilsResult | null>(null)
  const shouldRender = webEnv.NODE_ENV !== 'production'
  const stripePresetEnabled = Boolean(webEnv.STRIPE_PUBLISHABLE_KEY)

  const emailPreview = useMemo(() => {
    const prefix = draft.emailPrefix
      .trim()
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, '-')
      .replaceAll(/^-+|-+$/g, '')
    return `${prefix || 'dev-utils'}+<timestamp>@example.com`
  }, [draft.emailPrefix])

  const launchPresetMutation = useMutation({
    mutationFn: async (preset: CustomDevUtilsPresetId) => {
      queryClient.clear()
      return runCustomDevUtilsFlow(draft, preset)
    },
    onSuccess: (result, preset) => {
      setLastResult(result)
      setOpen(false)
      queryClient.clear()

      notify.success('Fresh dev workspace ready')

      if (
        (preset === 'stripe-pro-checkout' || preset === 'local-pro-credits-stripe-checkout')
        && result.checkoutUrl
      ) {
        handoffToCheckout(router, result.checkoutUrl)
        return
      }

      router.push(toAppHref(result))
    },
    onError: (error) => {
      notify.apiError(error, 'Failed to run dev utils flow')
    }
  })

  if (!shouldRender) {
    return <></>
  }

  return (
    <>
      <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2">
        <Button
          type="button"
          size="sm"
          className="gap-2 rounded-full shadow-lg shadow-black/20"
          onClick={() => setOpen((current) => !current)}
          aria-label="Open developer utilities"
        >
          <IconSparkles />
          Dev utils
        </Button>
      </div>

      {open ? (
        <Card className="fixed bottom-20 left-1/2 z-50 max-h-[calc(100dvh-5rem)] w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 overflow-y-auto border-primary/20 shadow-2xl">
          <CardHeader className="space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <CardTitle>Custom dev utils</CardTitle>
                  <Badge variant="secondary">Dev only</Badge>
                </div>
                <CardDescription>
                  Seed fast local QA states anywhere in the app: new account, new org, new workspace, and optional billing handoff.
                </CardDescription>
              </div>

              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={() => setOpen(false)}
                aria-label="Close dev utils"
              >
                <IconClose />
              </Button>
            </div>
          </CardHeader>

          <CardContent className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="custom-dev-utils-email-prefix">Email prefix</Label>
                <Input
                  id="custom-dev-utils-email-prefix"
                  value={draft.emailPrefix}
                  disabled={launchPresetMutation.isPending}
                  onChange={(event) => {
                    setDraft((current) => ({
                      ...current,
                      emailPrefix: event.target.value
                    }))
                  }}
                />
                <p className="text-xs text-muted-foreground">Unique run email: {emailPreview}</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="custom-dev-utils-user-name">User name base</Label>
                <Input
                  id="custom-dev-utils-user-name"
                  value={draft.userNameBase}
                  disabled={launchPresetMutation.isPending}
                  onChange={(event) => {
                    setDraft((current) => ({
                      ...current,
                      userNameBase: event.target.value
                    }))
                  }}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="custom-dev-utils-org-name">Org name base</Label>
                <Input
                  id="custom-dev-utils-org-name"
                  value={draft.organizationBaseName}
                  disabled={launchPresetMutation.isPending}
                  onChange={(event) => {
                    setDraft((current) => ({
                      ...current,
                      organizationBaseName: event.target.value
                    }))
                  }}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="custom-dev-utils-workspace-name">Workspace name base</Label>
                <Input
                  id="custom-dev-utils-workspace-name"
                  value={draft.workspaceBaseName}
                  disabled={launchPresetMutation.isPending}
                  onChange={(event) => {
                    setDraft((current) => ({
                      ...current,
                      workspaceBaseName: event.target.value
                    }))
                  }}
                />
              </div>
            </div>

            <div className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
              Password for every seeded user: <span className="font-medium text-foreground">{CUSTOM_DEV_UTILS_PASSWORD}</span>
            </div>

            <Separator />

            <div className="space-y-3">
              {presets
                .filter((preset) => stripePresetEnabled || !preset.requiresStripe)
                .map((preset) => (
                <div
                  key={preset.id}
                  className="rounded-xl border border-border/70 bg-background/80 p-4 shadow-sm"
                >
                  <div className="space-y-1">
                    <h3 className="font-medium">{preset.title}</h3>
                    <p className="text-sm text-muted-foreground">{preset.description}</p>
                  </div>
                  <Button
                    type="button"
                    className="mt-4 w-full justify-between"
                    variant={preset.id === 'local-pro-credits' ? 'default' : 'outline'}
                    aria-label={preset.title}
                    disabled={launchPresetMutation.isPending}
                    onClick={() => launchPresetMutation.mutate(preset.id)}
                  >
                    <span>{preset.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {launchPresetMutation.isPending ? 'Running...' : 'Launch'}
                    </span>
                  </Button>
                </div>
              ))}
            </div>

            <div className="rounded-lg border border-dashed bg-muted/30 p-3 text-xs text-muted-foreground">
              Running a preset replaces the current browser session with the new seeded account. Stripe presets use real Stripe only if the backend is configured with Stripe test keys; otherwise they follow the local stub path.
            </div>

            {lastResult ? (
              <div className="rounded-xl border border-emerald-300/60 bg-emerald-50/60 p-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-medium text-emerald-900">Latest seeded account</h3>
                  <Badge variant="secondary">Ready</Badge>
                </div>
                <dl className="mt-3 grid gap-2 text-sm text-emerald-950">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-emerald-800/80">Email</dt>
                    <dd className="font-medium">{lastResult.email}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-emerald-800/80">Org</dt>
                    <dd className="font-medium">{lastResult.organization.name}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-emerald-800/80">Workspace</dt>
                    <dd className="font-medium">{lastResult.team.name}</dd>
                  </div>
                </dl>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </>
  )
}
