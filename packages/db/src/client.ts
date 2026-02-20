import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema.js'

let poolSingleton: Pool | undefined

export const getPool = (): Pool => {
  if (!poolSingleton) {
    const connectionString = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/tx_agent_kit'
    poolSingleton = new Pool({ connectionString })
  }
  return poolSingleton
}

export const db = drizzle(getPool(), { schema })
