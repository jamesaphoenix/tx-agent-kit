'use client'

import { usageCategories } from '@tx-agent-kit/contracts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

export function BillingUsageSkeleton() {
  return (
    <div className="flex flex-col gap-6" data-testid="billing-usage-skeleton">
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton
            key={`usage-nav-skeleton-${index + 1}`}
            className="h-10 w-24 rounded-full"
          />
        ))}
      </div>

      <Skeleton className="h-16 w-full rounded-xl" />

      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton
            key={`usage-filter-skeleton-${index + 1}`}
            className="h-9 w-28 rounded-md"
          />
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <Card key={`usage-card-skeleton-${index + 1}`} className="shadow-sm">
            <CardHeader>
              <CardTitle>
                <Skeleton className="h-5 w-28" />
              </CardTitle>
              <CardDescription>
                <Skeleton className="h-4 w-full max-w-[15rem]" />
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <Skeleton className="h-10 w-32" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-40" />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>
            <Skeleton className="h-5 w-40" />
          </CardTitle>
          <CardDescription>
            <Skeleton className="h-4 w-full max-w-[20rem]" />
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {usageCategories.map((category) => (
            <div
              key={`usage-row-skeleton-${category}`}
              className="grid gap-2 rounded-lg border p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="grid gap-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-28" />
                </div>
                <Skeleton className="h-6 w-20 rounded-full" />
              </div>
              <Skeleton className="h-3 w-full" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
