export interface FailedPaymentIntentDetails {
  readonly id: string
  readonly status: string | null
  readonly clientSecret: string | null
}

export const readFailedPaymentIntentDetails = (
  paymentIntent: unknown
): FailedPaymentIntentDetails | null => {
  if (paymentIntent === null || typeof paymentIntent !== 'object') {
    return null
  }

  const record = paymentIntent as Record<string, unknown>
  const id = typeof record.id === 'string' ? record.id : ''
  const status = typeof record.status === 'string' ? record.status : null
  const clientSecret = typeof record.client_secret === 'string'
    ? record.client_secret
    : null

  return { id, status, clientSecret }
}
