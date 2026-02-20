'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { clientApi } from '../lib/client-api'

export function CreateTaskForm({ workspaceId }: { workspaceId: string }) {
  const router = useRouter()
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
      router.refresh()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to create task')
      setPending(false)
    }
  }

  return (
    <form className="stack" onSubmit={onSubmit}>
      <h3>Create Task</h3>
      <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ship invitation acceptance flow" required />
      <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Optional context" rows={4} />
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={pending}>{pending ? 'Creating...' : 'Create task'}</button>
    </form>
  )
}
