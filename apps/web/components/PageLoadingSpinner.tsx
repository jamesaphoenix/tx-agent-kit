'use client'

import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export function PageLoadingSpinner({
  className,
  label = 'Loading'
}: {
  className?: string
  label?: string
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      className={cn('flex min-h-64 items-center justify-center p-8', className)}
    >
      <Loader2 className="size-6 animate-spin text-primary" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </div>
  )
}
