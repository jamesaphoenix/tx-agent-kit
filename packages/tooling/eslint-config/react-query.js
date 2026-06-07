import { reactQueryPlugin } from './react-query-plugin.js'

export const reactQueryConfig = [
  {
    basePath: 'apps/web',
    files: ['**/*.{ts,tsx,js,jsx}'],
    ignores: ['**/*.test.ts', '**/*.test.tsx', '**/*.integration.test.ts', '**/*.integration.test.tsx'],
    plugins: {
      'tx-react-query': reactQueryPlugin
    },
    rules: {
      'tx-react-query/no-zero-staletime': 'error',
      'tx-react-query/require-query-key-factory': 'error'
    }
  }
]
