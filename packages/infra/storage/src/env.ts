const defaultAccountId = 'dc05faaea8d5f25755d84e55fe3a7d67'
const defaultEndpoint = `https://${defaultAccountId}.r2.cloudflarestorage.com`
const defaultBucketName = 'octospark-dev'

export interface StorageEnv {
  R2_ACCOUNT_ID: string
  R2_ACCESS_KEY_ID: string
  R2_SECRET_ACCESS_KEY: string
  R2_BUCKET_NAME: string
  R2_ENDPOINT: string
}

export const getStorageEnv = (): StorageEnv => {
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY

  if (accessKeyId && secretAccessKey) {
    return {
      R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID ?? defaultAccountId,
      R2_ACCESS_KEY_ID: accessKeyId,
      R2_SECRET_ACCESS_KEY: secretAccessKey,
      R2_BUCKET_NAME: process.env.R2_BUCKET_NAME ?? defaultBucketName,
      R2_ENDPOINT: process.env.R2_ENDPOINT ?? defaultEndpoint
    }
  }

  const nodeEnv = (process.env.NODE_ENV ?? '').toLowerCase()
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
