'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

export interface ProgressProps extends React.ComponentProps<'div'> {
  readonly value?: number
}

export function Progress({
  className,
  value = 0,
  ...props
}: ProgressProps): React.ReactElement {
  const clamped = Math.max(0, Math.min(100, value))

  return (
    <div
      data-slot="progress"
      className={cn('bg-muted relative h-2 w-full overflow-hidden rounded-full', className)}
      {...props}
    >
      <div
        data-slot="progress-indicator"
        className="bg-primary h-full transition-all"
        style={{ width: `${clamped.toString()}%` }}
      />
    </div>
  )
}
