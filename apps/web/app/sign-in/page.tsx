import Link from 'next/link'
import { AuthForm } from '../../components/AuthForm'

export default async function SignInPage({
  searchParams
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const params = await searchParams
  const nextPath = typeof params.next === 'string' && params.next.startsWith('/') ? params.next : '/dashboard'

  return (
    <section className="card" style={{ maxWidth: '460px', margin: '2rem auto' }}>
      <div className="stack">
        <h1>Sign in</h1>
        <p className="muted">Access your workspaces, invitations, and execution dashboard.</p>
        <AuthForm mode="sign-in" nextPath={nextPath} />
        <p className="muted">
          No account yet? <Link href="/sign-up">Create one</Link>
        </p>
      </div>
    </section>
  )
}
