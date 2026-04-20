const defaultAccountId = 'dc05faaea8d5f25755d84e55fe3a7d67'
const defaultBucketName = 'tx-agent-kit-dev'
const testAccessKeyId = 'test-r2-access-key-id'
const testSecretAccessKey = 'test-r2-secret-access-key'

const endpointFor = (accountId: string): string =>
  `https://${accountId}.r2.cloudflarestorage.com`

const readOptionalEnv = (name: string): string | undefined => {
  const value = process.env[name]?.trim()
  return value && value.length > 0 ? value : undefined
}

export interface StorageEnv {
  R2_ACCOUNT_ID: string
  R2_ACCESS_KEY_ID: string
  R2_SECRET_ACCESS_KEY: string
  R2_BUCKET_NAME: string
  R2_ENDPOINT: string
}

export const getStorageEnv = (): StorageEnv => {
  const accountId = readOptionalEnv('R2_ACCOUNT_ID') ?? defaultAccountId
  const accessKeyId = readOptionalEnv('R2_ACCESS_KEY_ID')
  const secretAccessKey = readOptionalEnv('R2_SECRET_ACCESS_KEY')
  const bucketName = readOptionalEnv('R2_BUCKET_NAME')
  const endpoint = readOptionalEnv('R2_ENDPOINT') ?? endpointFor(accountId)

  if (accessKeyId && secretAccessKey) {
    return {
      R2_ACCOUNT_ID: accountId,
      R2_ACCESS_KEY_ID: accessKeyId,
      R2_SECRET_ACCESS_KEY: secretAccessKey,
      R2_BUCKET_NAME: bucketName ?? defaultBucketName,
      R2_ENDPOINT: endpoint
    }
  }

  const nodeEnv = (process.env.NODE_ENV ?? '').toLowerCase()
  if (nodeEnv === 'test' && !accessKeyId && !secretAccessKey) {
    return {
      R2_ACCOUNT_ID: accountId,
      R2_ACCESS_KEY_ID: testAccessKeyId,
      R2_SECRET_ACCESS_KEY: testSecretAccessKey,
      R2_BUCKET_NAME: bucketName ?? defaultBucketName,
      R2_ENDPOINT: endpoint
    }
  }

  if (nodeEnv === 'production' || nodeEnv === 'staging') {
    throw new Error(
      'R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY must be set in production and staging environments'
    )
  }

  throw new Error(
    'R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY are required. ' +
    'Set them in your .env file or inject via 1Password: op run --env-file=.env.dev -- <command>'
  )
}
