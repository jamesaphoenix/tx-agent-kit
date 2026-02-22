const defaultDatabaseUrl = 'postgres://postgres:postgres@localhost:5432/tx_agent_kit'

export interface DbEnv {
  DATABASE_URL: string
}

export const getDbEnv = (): DbEnv => {
  return {
    DATABASE_URL: process.env.DATABASE_URL ?? defaultDatabaseUrl
  }
}
