const getMessage = (value: unknown): string | null => {
  if (value instanceof Error && value.message.trim().length > 0) {
    return value.message.trim()
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim()
  }
  return null
}

const getCause = (value: unknown): unknown => {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }
  return (value as { readonly cause?: unknown }).cause
}

export const formatWorkflowFailureReason = (error: unknown): string => {
  const messages: string[] = []
  const seen = new Set<unknown>()
  let current: unknown = error

  while (current !== undefined && current !== null) {
    if (typeof current === 'object') {
      if (seen.has(current)) {
        break
      }
      seen.add(current)
    }

    const message = getMessage(current)
    if (message && !messages.includes(message)) {
      messages.push(message)
    }

    const cause = getCause(current)
    if (cause === undefined || cause === current) {
      break
    }
    current = cause
  }

  return messages.length > 0 ? messages.join(' caused by: ') : String(error)
}
