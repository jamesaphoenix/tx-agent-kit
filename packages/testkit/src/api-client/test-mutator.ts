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
  { url, method, params, data, headers }: {
    url: string
    method: string
    params?: Record<string, string>
    data?: unknown
    headers?: Record<string, string>
    signal?: AbortSignal
  }
): Promise<T> => {
  const resolvedUrl = new URL(`${clientBaseUrl}${url}`)

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      resolvedUrl.searchParams.set(key, value)
    }
  }

  const mergedHeaders: Record<string, string> = {
    'content-type': 'application/json',
    ...clientHeaders,
    ...(headers ?? {})
  }

  if (authToken) {
    mergedHeaders.authorization = `Bearer ${authToken}`
  }

  const init: RequestInit = {
    method,
    headers: mergedHeaders
  }

  if (data !== undefined) {
    init.body = JSON.stringify(data)
  }

  const response = await fetch(resolvedUrl.toString(), init)
  const text = await response.text()

  if (!response.ok) {
    throw new Error(
      `testFetchInstance: ${method} ${url} returned ${response.status}: ${text}`
    )
  }

  if (!text) {
    return undefined as T
  }

  return JSON.parse(text) as T
}

export default testFetchInstance
