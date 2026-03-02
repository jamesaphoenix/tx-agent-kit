import { defineConfig } from 'orval'

export default defineConfig({
  testClient: {
    input: {
      target: '../../apps/api/openapi.json'
    },
    output: {
      mode: 'tags-split',
      target: './src/api-client/generated',
      schemas: './src/api-client/generated/schemas',
      client: 'fetch',
      clean: true,
      override: {
        mutator: {
          path: './src/api-client/test-mutator.ts',
          name: 'testFetchInstance'
        }
      }
    }
  }
})
