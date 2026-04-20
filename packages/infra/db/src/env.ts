const defaultDatabaseUrl = 'postgres://postgres:postgres@localhost:5432/tx_agent_kit'

export interface DbEnv {
  DATABASE_URL: string
  DB_POOL_MAX: number
}

export const getDbEnv = (): DbEnv => {
  const url = process.env.DATABASE_URL
  if (url) {
    return { DATABASE_URL: url, DB_POOL_MAX: parsePoolMax() }
  }

  const nodeEnv = (process.env.NODE_ENV ?? '').toLowerCase()
  if (nodeEnv === 'production' || nodeEnv === 'staging') {
    throw new Error('DATABASE_URL must be set in production and staging environments')
  }

  return { DATABASE_URL: defaultDatabaseUrl, DB_POOL_MAX: parsePoolMax() }
}

const parsePoolMax = (): number => {
  const raw = process.env.DB_POOL_MAX
  if (!raw) {
    return 20
  }
  const parsed = Number.parseInt(raw, 10)
  return Number.isNaN(parsed) || parsed < 1 ? 20 : parsed
}
