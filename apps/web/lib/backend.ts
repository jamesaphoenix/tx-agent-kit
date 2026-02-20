import { cookies } from 'next/headers'

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:4000'

export const getTokenFromCookies = async (): Promise<string | null> => {
  const cookieStore = await cookies()
  return cookieStore.get('tx_agent_token')?.value ?? null
}

export const backendFetch = async <T>(
  path: string,
  init?: RequestInit,
  token?: string
): Promise<T> => {
  const resolvedToken = token ?? (await getTokenFromCookies())
  const headers = new Headers(init?.headers)

  if (!headers.has('content-type') && init?.body) {
    headers.set('content-type', 'application/json')
  }

  if (resolvedToken) {
    headers.set('authorization', `Bearer ${resolvedToken}`)
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
    cache: 'no-store'
  })

  const bodyText = await response.text()
  const json = bodyText ? JSON.parse(bodyText) : {}

  if (!response.ok) {
    const errorMessage = typeof json?.message === 'string'
      ? json.message
      : typeof json?.error?.message === 'string'
        ? json.error.message
        : `Request failed: ${response.status}`
    throw new Error(errorMessage)
  }

  return json as T
}
