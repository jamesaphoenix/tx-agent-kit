import { randomUUID } from 'node:crypto'

let sequence = 0

const nextSequence = (): number => {
  sequence += 1
  return sequence
}

export const generateId = (): string => randomUUID()

export const generateTimestamp = (): Date => new Date()

export const generateFutureTimestamp = (msFromNow: number): Date => {
  return new Date(Date.now() + msFromNow)
}

export const generateUniqueValue = (prefix: string): string => {
  return `${prefix}-${Date.now()}-${nextSequence()}`
}

export const generateEmail = (prefix = 'user'): string => {
  return `${prefix}.${Date.now()}.${nextSequence()}@example.com`
}

export const generateToken = (prefix = 'token'): string => {
  return `${prefix}_${Date.now()}_${nextSequence()}`
}
