import type { users } from '../schema.js'
import { generateEmail, generateId, generateTimestamp, generateUniqueValue } from './factory-helpers.js'

type UserInsert = typeof users.$inferInsert

export interface CreateUserFactoryOptions {
  id?: string
  email?: string
  passwordHash?: string
  name?: string
  createdAt?: Date
}

export const createUserFactory = (options: CreateUserFactoryOptions = {}): UserInsert => {
  return {
    id: options.id ?? generateId(),
    email: options.email ?? generateEmail('user'),
    passwordHash: options.passwordHash ?? generateUniqueValue('password-hash'),
    name: options.name ?? generateUniqueValue('User'),
    createdAt: options.createdAt ?? generateTimestamp()
  }
}
