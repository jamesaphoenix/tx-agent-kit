import { eq } from 'drizzle-orm'
import { db } from '../client.js'
import { users } from '../schema.js'

export const usersRepository = {
  create: (input: { email: string; passwordHash: string; name: string }) =>
    db.insert(users).values(input).returning().then((rows) => rows[0] ?? null),

  findByEmail: (email: string) =>
    db.query.users.findFirst({ where: eq(users.email, email) }),

  findById: (id: string) =>
    db.query.users.findFirst({ where: eq(users.id, id) }),

  deleteById: (id: string) =>
    db.delete(users).where(eq(users.id, id)).returning().then((rows) => rows[0] ?? null)
}
