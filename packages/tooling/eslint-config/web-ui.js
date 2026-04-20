import { webUiPlugin } from './web-ui-plugin.js'

export const webUiConfig = [
  {
    basePath: 'apps/web',
    files: ['**/*.{tsx,jsx}'],
    ignores: ['components/ui/dialog.tsx'],
    plugins: {
      'tx-web-ui': webUiPlugin
    },
    rules: {
      'tx-web-ui/no-raw-dialog-role': 'error'
    }
  }
]
