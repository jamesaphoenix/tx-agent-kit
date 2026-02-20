import { defineConfig, mergeConfig } from 'vitest/config'
import { unitConfig } from './unit'

export const integrationConfig = mergeConfig(
  unitConfig,
  defineConfig({
  test: {
    testTimeout: 60000,
    hookTimeout: 60000
  }
})
)

export default integrationConfig
