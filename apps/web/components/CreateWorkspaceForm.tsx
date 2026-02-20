'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { clientApi } from '../lib/client-api'

export function CreateWorkspaceForm() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPending(true)
    setError(null)

    try {
      await clientApi.createWorkspace({ name })
      setName('')
      router.refresh()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to create workspace')
      setPending(false)
    }
  }

  return (
    <form className="stack" onSubmit={onSubmit}>
      <h3>Create Workspace</h3>
      <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Growth Experiments" minLength={2} maxLength={64} required />
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={pending}>{pending ? 'Creating...' : 'Create workspace'}</button>
    </form>
  )
}
