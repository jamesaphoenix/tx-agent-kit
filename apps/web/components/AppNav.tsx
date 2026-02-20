import Link from 'next/link'
import { SignOutButton } from './SignOutButton'

export function AppNav() {
  return (
    <div className="row" style={{ justifyContent: 'space-between', marginBottom: '1rem' }}>
      <nav className="nav">
        <Link href="/dashboard">Dashboard</Link>
        <Link href="/workspaces">Workspaces</Link>
        <Link href="/invitations">Invitations</Link>
      </nav>
      <div style={{ width: '160px' }}>
        <SignOutButton />
      </div>
    </div>
  )
}
