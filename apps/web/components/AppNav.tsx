'use client'

import Link from 'next/link'
import { SignOutButton } from './SignOutButton'

interface AppNavProps {
  orgId?: string
  teamId?: string
}

export function AppNav({ orgId, teamId }: AppNavProps) {
  const base = orgId && teamId ? `/org/${orgId}/${teamId}` : ''
  const workspacesHref = orgId ? `/org/${orgId}/workspaces` : '/org'

  return (
    <div className="row" style={{ justifyContent: 'space-between', marginBottom: '1rem' }}>
      <nav className="nav">
        {base ? (
          <>
            <Link href={base}>Dashboard</Link>
            <Link href={workspacesHref}>Workspaces</Link>
          </>
        ) : (
          <>
            <Link href="/dashboard">Dashboard</Link>
            <Link href="/organizations">Organizations</Link>
          </>
        )}
        <Link href="/invitations">Invitations</Link>
      </nav>
      <div style={{ width: '160px' }}>
        <SignOutButton />
      </div>
    </div>
  )
}
