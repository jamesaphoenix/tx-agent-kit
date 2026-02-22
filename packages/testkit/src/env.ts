export interface TestkitEnv {
  DATABASE_URL: string | undefined
}

export const getTestkitEnv = (): TestkitEnv => {
  return {
    DATABASE_URL: process.env.DATABASE_URL
  }
}

export const getTestkitProcessEnv = (): NodeJS.ProcessEnv => {
  return { ...process.env }
}
