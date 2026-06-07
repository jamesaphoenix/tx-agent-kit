'use client'

import {
  BoneyardPageSkeleton,
  type BoneyardPageSkeletonVariant
} from '@/components/ui/boneyard-page-skeleton'
import { getWebEnv, shouldRenderDeveloperTools } from '@/lib/env'

const VARIANTS: readonly BoneyardPageSkeletonVariant[] = [
  'detail',
  'list',
  'grid',
  'analytics',
  'calendar'
]

/**
 * Developer-only gallery of every {@link BoneyardPageSkeleton} variant. This is
 * the capture target for the `boneyard:capture` script (see
 * `boneyard.config.json`): it renders each skeleton in isolation so the
 * harness can snapshot route-accurate bones. Hidden in production-like
 * environments.
 */
export default function BoneyardSkeletonsPage() {
  const webEnv = getWebEnv()

  if (!shouldRenderDeveloperTools(webEnv.NODE_ENV)) {
    return null
  }

  return (
    <div className="flex flex-col gap-12 p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold tracking-tight">Boneyard skeletons</h1>
        <p className="text-sm text-muted-foreground">
          Capture gallery for route-accurate loading skeletons.
        </p>
      </header>

      {VARIANTS.map((variant) => (
        <section key={variant} className="flex flex-col gap-3" data-boneyard-variant={variant}>
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            {variant}
          </h2>
          <BoneyardPageSkeleton variant={variant} label={`${variant} skeleton`} />
        </section>
      ))}
    </div>
  )
}
