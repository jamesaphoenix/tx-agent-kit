'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const navItems = [
  { label: 'Overview', suffix: '' },
  { label: 'Plans', suffix: '/plans' },
  { label: 'History', suffix: '/history' },
  { label: 'Usage', suffix: '/usage' },
  { label: 'Settings', suffix: '/settings' }
] as const

export interface BillingRouteNavProps {
  readonly organizationId: string
}

export function BillingRouteNav({
  organizationId
}: BillingRouteNavProps): React.ReactElement {
  const pathname = usePathname()

  return (
    <nav aria-label="Billing sections" className="flex flex-wrap gap-2">
      {navItems.map((item) => {
        const href = `/org/${organizationId}/billing${item.suffix}`
        const isActive = pathname === href

        return (
          <Link
            key={item.label}
            href={href}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              buttonVariants({ variant: isActive ? 'default' : 'outline', size: 'sm' }),
              'rounded-full'
            )}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
