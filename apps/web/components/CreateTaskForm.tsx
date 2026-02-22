'use client'

import { useState, type FormEvent } from 'react'
import { clientApi } from '../lib/client-api'
import { notify } from '../lib/notify'

export function CreateTaskForm({
  workspaceId,
  onCreated
}: {
  workspaceId: string
  onCreated?: () => void | Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPending(true)
    setError(null)

    try {
      await clientApi.createTask({
        workspaceId,
        title,
        description: description || undefined
      })

      setTitle('')
      setDescription('')
      notify.success('Task created')
      await onCreated?.()
      setPending(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create task'
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
      <h3>Create Task</h3>
      <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ship invitation acceptance flow" required />
      <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Optional context" rows={4} />
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={pending}>{pending ? 'Creating...' : 'Create task'}</button>
    </form>
  )
}
