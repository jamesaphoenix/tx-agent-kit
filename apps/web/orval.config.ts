import { defineConfig } from 'orval'

export default defineConfig({
  txAgentKit: {
    input: {
      target: '../api/openapi.json'
    },
    output: {
      mode: 'tags-split',
      target: './lib/api/generated',
      schemas: './lib/api/generated/schemas',
      client: 'react-query',
      httpClient: 'axios',
      clean: true,
      override: {
        mutator: {
          path: './lib/api/orval-mutator.ts',
          name: 'customInstance'
        },
        query: {
          useQuery: true,
          useInfinite: false,
          useSuspenseQuery: false
        }
      }
    }
  }
})
