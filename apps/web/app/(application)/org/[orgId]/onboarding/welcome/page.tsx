'use client'

import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useCurrentPrincipal } from '@/hooks/use-session-store'
import { DashboardShell } from '@/components/DashboardShell'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function WelcomeOnboardingPage(): React.ReactElement {
  const params = useParams<{ orgId: string }>()
  const router = useRouter()
  const principal = useCurrentPrincipal()
  const orgId = params.orgId

  return (
    <DashboardShell
      title="Welcome"
      subtitle="Your first successful charge unlocked welcome credit and the final billing guardrails."
      principalEmail={principal?.email}
      orgId={orgId}
    >
      <div className="mx-auto grid max-w-3xl gap-6">
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>You&apos;re funded and ready to go</CardTitle>
            <CardDescription>
              Here&apos;s your $20 welcome credit to get started. Before you run paid AI work, you can set an optional monthly spend cap.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="rounded-lg border bg-muted/30 p-4">
              <p className="text-sm text-muted-foreground">
                Spend caps are optional. They act as a hard stop if usage reaches the amount you choose, and you can change or remove the cap anytime from billing settings.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <Button
                type="button"
                onClick={() => {
                  router.push(`/org/${orgId}/onboarding/spend-cap`)
                }}
              >
                Set spend cap
              </Button>
              <Link
                href={`/org/${orgId}/billing`}
                className={buttonVariants({ variant: 'outline' })}
              >
                Skip to billing
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardShell>
  )
}
