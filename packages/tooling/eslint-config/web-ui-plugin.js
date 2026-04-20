const getLiteralValue = (node) => {
  if (!node) {
    return null
  }

  if (node.type === 'Literal') {
    return node.value
  }

  if (node.type === 'JSXExpressionContainer' && node.expression.type === 'Literal') {
    return node.expression.value
  }

  return null
}

export const webUiPlugin = {
  rules: {
    'no-raw-dialog-role': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Require web modals to use the shared Dialog primitive.'
        },
        messages: {
          useSharedDialog: 'Use apps/web/components/ui/dialog.tsx instead of hand-rolling role="dialog" so Escape and close behavior stay centralized.'
        },
        schema: []
      },
      create(context) {
        return {
          JSXAttribute(node) {
            if (node.name.type !== 'JSXIdentifier' || node.name.name !== 'role') {
              return
            }

            if (getLiteralValue(node.value) !== 'dialog') {
              return
            }

            context.report({
              node,
              messageId: 'useSharedDialog'
            })
          }
        }
      }
    }
  }
}
