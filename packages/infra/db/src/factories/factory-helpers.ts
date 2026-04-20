import { randomUUID } from 'node:crypto'

let sequence = 0

const nextSequence = (): number => {
  sequence += 1
  return sequence
}

// Short process-unique suffix appended to every generated identifier to
// prevent cross-process collisions when multiple vitest workers run in
// parallel. Each worker is its own Node process with its own
// `sequence = 0` counter, so a naive `${Date.now()}-${sequence}` can
// collide across workers that happen to call the factory in the same
// millisecond with the same counter value — producing duplicate emails
// and 409 Conflict on sign-up. The UUID segment is cryptographically
// unique; sequence + timestamp are kept for human readability when
// debugging test output.
const processUnique = (): string => randomUUID().slice(0, 8)

export const generateId = (): string => randomUUID()

export const generateTimestamp = (): Date => new Date()

export const generateFutureTimestamp = (msFromNow: number): Date => {
  return new Date(Date.now() + msFromNow)
}

export const generateUniqueValue = (prefix: string): string => {
  return `${prefix}-${Date.now()}-${nextSequence()}-${processUnique()}`
}

export const generateEmail = (prefix = 'user'): string => {
  return `${prefix}.${Date.now()}.${nextSequence()}.${processUnique()}@example.com`
}

export const generateToken = (prefix = 'token'): string => {
  return `${prefix}_${Date.now()}_${nextSequence()}_${processUnique()}`
}
