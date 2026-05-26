'use client'

import type { ReactNode } from 'react'
import { ProtectedClientRoute } from '@/components/ProtectedClientRoute'

export default function ApplicationLayout({ children }: { children: ReactNode }) {
  return <ProtectedClientRoute>{children}</ProtectedClientRoute>
}
