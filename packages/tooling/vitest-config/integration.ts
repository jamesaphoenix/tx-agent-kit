import { defineConfig, mergeConfig } from 'vitest/config'
import { unitConfig } from './unit.ts'

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback
  }

  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed) || parsed < 1) {
    return fallback
  }

  return parsed
}

const integrationMaxWorkers = parsePositiveInt(process.env.INTEGRATION_MAX_WORKERS, 2)

export const integrationConfig = mergeConfig(
  unitConfig,
  defineConfig({
    test: {
      testTimeout: 60000,
      hookTimeout: 60000,
      maxWorkers: integrationMaxWorkers,
      fileParallelism: integrationMaxWorkers > 1
    }
  })
)

export default integrationConfig
