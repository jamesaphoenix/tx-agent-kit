const defaultDatabaseUrl = 'postgres://postgres:postgres@localhost:5432/tx_agent_kit'

export interface DbEnv {
  DATABASE_URL: string
}

export const getDbEnv = (): DbEnv => {
  const url = process.env.DATABASE_URL
  if (url) {
    return { DATABASE_URL: url }
  }

  const nodeEnv = (process.env.NODE_ENV ?? '').toLowerCase()
  if (nodeEnv === 'production' || nodeEnv === 'staging') {
    throw new Error('DATABASE_URL must be set in production and staging environments')
  }

  return { DATABASE_URL: defaultDatabaseUrl }
}
