'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

function Avatar({
  className,
  size,
  ...props
}: React.ComponentProps<'span'> & {
  size?: 'sm' | 'md' | 'lg'
}) {
  const sizeClasses: Record<string, string> = {
    sm: 'size-6',
    md: 'size-8',
    lg: 'size-10'
  }

  return (
    <span
      data-slot="avatar"
      className={cn(
        'relative flex shrink-0 overflow-hidden rounded-full',
        sizeClasses[size ?? 'md'],
        className
      )}
      {...props}
    />
  )
}

function AvatarImage({
  className,
  ...props
}: React.ComponentProps<'img'>) {
  return (
    <img
      data-slot="avatar-image"
      className={cn('aspect-square size-full', className)}
      {...props}
    />
  )
}

function AvatarFallback({
  className,
  ...props
}: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="avatar-fallback"
      className={cn(
        'bg-muted flex size-full items-center justify-center rounded-full text-xs',
        className
      )}
      {...props}
    />
  )
}

export { Avatar, AvatarImage, AvatarFallback }
