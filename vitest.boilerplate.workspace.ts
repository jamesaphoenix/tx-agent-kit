import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: ['packages/testkit/vitest.boilerplate.config.ts'],
    globalSetup: ['./scripts/test/vitest-global-setup.ts'],
    passWithNoTests: false
  }
})
