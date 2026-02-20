import Link from 'next/link'
import { AuthForm } from '../../components/AuthForm'

export default async function SignUpPage({
  searchParams
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const params = await searchParams
  const nextPath = typeof params.next === 'string' && params.next.startsWith('/') ? params.next : '/dashboard'

  return (
    <section className="card" style={{ maxWidth: '460px', margin: '2rem auto' }}>
      <div className="stack">
        <h1>Create account</h1>
        <p className="muted">Get into your agent workspace in under a minute.</p>
        <AuthForm mode="sign-up" nextPath={nextPath} />
        <p className="muted">
          Already have an account? <Link href="/sign-in">Sign in</Link>
        </p>
      </div>
    </section>
  )
}
