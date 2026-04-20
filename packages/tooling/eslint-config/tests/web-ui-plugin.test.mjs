import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import test from 'node:test'
import { ESLint } from 'eslint'
import tseslint from 'typescript-eslint'
import { webUiPlugin } from '../web-ui-plugin.js'

const lint = async (code, filePath = resolve('apps/web/components/Foo.tsx')) => {
  const eslint = new ESLint({
    overrideConfigFile: true,
    ignore: false,
    overrideConfig: [
      {
        files: ['**/*.{ts,tsx}'],
        languageOptions: {
          parser: tseslint.parser,
          parserOptions: {
            ecmaFeatures: { jsx: true },
            ecmaVersion: 'latest',
            sourceType: 'module'
          }
        },
        plugins: {
          'tx-web-ui': webUiPlugin
        },
        rules: {
          'tx-web-ui/no-raw-dialog-role': 'error'
        }
      }
    ]
  })

  const [result] = await eslint.lintText(code, { filePath })
  return result.messages
}

test('no-raw-dialog-role reports hand-rolled web dialogs', async () => {
  const messages = await lint('export function Foo() { return <div role="dialog" /> }')

  assert.equal(messages.length, 1)
  assert.equal(messages[0].ruleId, 'tx-web-ui/no-raw-dialog-role')
})

test('no-raw-dialog-role reports expression literal dialog roles', async () => {
  const messages = await lint("export function Foo() { return <div role={'dialog'} /> }")

  assert.equal(messages.length, 1)
  assert.equal(messages[0].ruleId, 'tx-web-ui/no-raw-dialog-role')
})

test('no-raw-dialog-role allows shared Dialog usage', async () => {
  const messages = await lint(`
    import { Dialog, DialogContent } from '@/components/ui/dialog'

    export function Foo() {
      return (
        <Dialog open onOpenChange={() => {}}>
          <DialogContent />
        </Dialog>
      )
    }
  `)

  assert.equal(messages.length, 0)
})
