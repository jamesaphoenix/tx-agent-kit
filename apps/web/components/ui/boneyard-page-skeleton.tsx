'use client'

import type { ReactElement } from 'react'

import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * Page-level loading skeleton variants used while a route's data resolves.
 *
 * These are dependency-free shadcn Card + Skeleton compositions: a static
 * fallback that approximates each page's layout so navigation never flashes a
 * blank screen. They are also the building block for the boneyard capture
 * harness (see {@link file://../../lib/boneyard}): a `boneyard:capture` script
 * snapshots the real rendered DOM into per-route fixtures, and a generated
 * registry swaps these fallbacks for pixel-accurate bones at runtime. The
 * registry/fixtures and the runtime swap are wired separately; this component
 * is the always-available baseline.
 */
export type BoneyardPageSkeletonVariant =
  | 'analytics'
  | 'calendar'
  | 'detail'
  | 'grid'
  | 'list'

export interface BoneyardPageSkeletonProps {
  readonly label?: string
  readonly variant?: BoneyardPageSkeletonVariant
  readonly className?: string
}

export function BoneyardPageSkeleton({
  label = 'Loading page',
  variant = 'detail',
  className
}: BoneyardPageSkeletonProps): ReactElement {
  return (
    <div role="status" aria-label={label}>
      <BoneyardPageSkeletonFallback variant={variant} className={className} />
      <span className="sr-only">{label}</span>
    </div>
  )
}

function BoneyardPageSkeletonFallback({
  variant,
  className
}: {
  readonly variant: BoneyardPageSkeletonVariant
  readonly className?: string
}): ReactElement {
  if (variant === 'grid') {
    return (
      <div className={cn('grid gap-4 md:grid-cols-2 xl:grid-cols-3', className)}>
        {Array.from({ length: 6 }).map((_, index) => (
          <SkeletonCard key={index} lines={3} />
        ))}
      </div>
    )
  }

  if (variant === 'analytics') {
    return (
      <div className={cn('flex flex-col gap-6', className)}>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <SkeletonCard key={index} lines={2} />
          ))}
        </div>
        <Card className="shadow-sm">
          <CardHeader className="gap-2">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-4 w-72 max-w-full" />
          </CardHeader>
          <CardContent className="grid gap-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="grid gap-3 rounded-md border border-border/60 p-3 md:grid-cols-[minmax(0,1fr)_7rem_7rem]">
                <Skeleton className="h-4 w-56 max-w-full" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    )
  }

  if (variant === 'calendar') {
    return (
      <div className={cn('flex min-h-0 flex-1 flex-col gap-4', className)}>
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
          <div className="flex items-end gap-3">
            <Skeleton className="h-10 w-10 rounded-md" />
            <Skeleton className="h-10 w-10 rounded-md" />
            <div className="space-y-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-9 w-64 max-w-full" />
            </div>
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-10 w-40 rounded-md" />
            <Skeleton className="h-10 w-14 rounded-md" />
          </div>
        </div>
        <div className="grid flex-1 gap-2 rounded-xl border border-border/70 bg-background p-3 md:grid-cols-7">
          {Array.from({ length: 35 }).map((_, index) => (
            <div key={index} className="min-h-24 rounded-md border border-border/50 p-2">
              <Skeleton className="h-4 w-10" />
              {index % 3 === 0 ? <Skeleton className="mt-3 h-5 w-full rounded-md" /> : null}
              {index % 5 === 0 ? <Skeleton className="mt-2 h-5 w-4/5 rounded-md" /> : null}
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (variant === 'list') {
    return (
      <div className={cn('flex flex-col gap-3', className)}>
        {Array.from({ length: 5 }).map((_, index) => (
          <Card key={index} className="shadow-sm">
            <CardContent className="flex items-center justify-between gap-4 p-4">
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-44 max-w-full" />
                <Skeleton className="h-3 w-64 max-w-full" />
              </div>
              <Skeleton className="h-9 w-24" />
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  return (
    <div className={cn('flex flex-col gap-6', className)}>
      <div className="grid gap-6 lg:grid-cols-2">
        <SkeletonCard lines={4} />
        <SkeletonCard lines={4} />
      </div>
      <SkeletonCard lines={6} />
    </div>
  )
}

function SkeletonCard({ lines }: { readonly lines: number }): ReactElement {
  return (
    <Card className="shadow-sm">
      <CardHeader className="gap-2">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-64 max-w-full" />
      </CardHeader>
      <CardContent className="grid gap-3">
        {Array.from({ length: lines }).map((_, index) => (
          <div key={index} className="flex items-center justify-between gap-4">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-36" />
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
