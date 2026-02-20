import promise from 'eslint-plugin-promise'

export const promiseConfig = [
  {
    plugins: {
      promise
    },
    rules: {
      'promise/always-return': 'off',
      'promise/no-return-wrap': 'error',
      'promise/param-names': 'error',
      'promise/no-nesting': 'off',
      'promise/no-new-statics': 'error'
    }
  }
]
