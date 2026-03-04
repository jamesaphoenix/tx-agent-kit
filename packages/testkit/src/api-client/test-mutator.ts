let clientBaseUrl = ''
let clientHeaders: Record<string, string> = {}
let authToken: string | undefined

export const configureTestClient = (opts: {
  baseUrl: string
  headers?: Record<string, string>
}): void => {
  clientBaseUrl = opts.baseUrl
  clientHeaders = opts.headers ?? {}
}

export const setTestAuthToken = (token: string): void => {
  authToken = token
}

export const clearTestAuthToken = (): void => {
  authToken = undefined
}

export const testFetchInstance = async <T>(
  url: string,
  init?: RequestInit
): Promise<T> => {
  const resolvedUrl = new URL(`${clientBaseUrl}${url}`)

  const incomingHeaders = init?.headers instanceof Headers
    ? Object.fromEntries(init.headers.entries())
    : (init?.headers as Record<string, string> | undefined) ?? {}

  const mergedHeaders: Record<string, string> = {
    'content-type': 'application/json',
    ...clientHeaders,
    ...incomingHeaders
  }

  if (authToken) {
    mergedHeaders.authorization = `Bearer ${authToken}`
  }

  const response = await fetch(resolvedUrl.toString(), {
    ...init,
    headers: mergedHeaders
  })
  const text = await response.text()
  const data: unknown = text ? JSON.parse(text) as unknown : undefined

  return { data, status: response.status, headers: response.headers } as T
}

export default testFetchInstance
