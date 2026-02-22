'use client'

import { useState, type FormEvent } from 'react'
import { clientApi } from '../lib/client-api'
import { notify } from '../lib/notify'

export function CreateWorkspaceForm({
  onCreated
}: {
  onCreated?: () => void | Promise<void>
}) {
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
      notify.success('Workspace created')
      await onCreated?.()
      setPending(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create workspace'
      setError(message)
      notify.error(message)
      setPending(false)
    }
  }

  return (
    <form
      className="stack"
      onSubmit={(event) => {
        void onSubmit(event)
      }}
    >
      <h3>Create Workspace</h3>
      <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Growth Experiments" minLength={2} maxLength={64} required />
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={pending}>{pending ? 'Creating...' : 'Create workspace'}</button>
    </form>
  )
}
