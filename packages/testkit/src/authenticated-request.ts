import type { ApiFactoryContext } from './api-factories.js'
import type { ApiResult } from './api-assertions.js'

export interface AuthenticatedRequestClient {
  get: <T = unknown>(path: string, caseName: string) => Promise<ApiResult<T>>
  post: <T = unknown>(path: string, body: unknown, caseName: string) => Promise<ApiResult<T>>
  put: <T = unknown>(path: string, body: unknown, caseName: string) => Promise<ApiResult<T>>
  patch: <T = unknown>(path: string, body: unknown, caseName: string) => Promise<ApiResult<T>>
  delete: <T = unknown>(path: string, caseName: string) => Promise<ApiResult<T>>
  raw: (path: string, init: RequestInit, caseName: string) => Promise<Response>
}

const buildHeaders = (
  context: ApiFactoryContext,
  token: string,
  caseName: string
): Record<string, string> => ({
  'content-type': 'application/json',
  authorization: `Bearer ${token}`,
  ...context.testContext.headersForCase(caseName)
})

const parseBody = async (response: Response): Promise<unknown> => {
  const text = await response.text()
  if (!text) {
    return null
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

const request = async <T>(
  context: ApiFactoryContext,
  token: string,
  method: string,
  path: string,
  caseName: string,
  body?: unknown
): Promise<ApiResult<T>> => {
  const url = `${context.baseUrl}${path}`
  const headers = buildHeaders(context, token, caseName)
  const init: RequestInit = { method, headers }

  if (body !== undefined) {
    init.body = JSON.stringify(body)
  }

  const response = await fetch(url, init)
  const parsed = await parseBody(response)

  return { response, body: parsed as T }
}

export const asUser = (
  context: ApiFactoryContext,
  session: { token: string }
): AuthenticatedRequestClient => {
  const { token } = session

  return {
    get: <T = unknown>(path: string, caseName: string) =>
      request<T>(context, token, 'GET', path, caseName),

    post: <T = unknown>(path: string, body: unknown, caseName: string) =>
      request<T>(context, token, 'POST', path, caseName, body),

    put: <T = unknown>(path: string, body: unknown, caseName: string) =>
      request<T>(context, token, 'PUT', path, caseName, body),

    patch: <T = unknown>(path: string, body: unknown, caseName: string) =>
      request<T>(context, token, 'PATCH', path, caseName, body),

    delete: <T = unknown>(path: string, caseName: string) =>
      request<T>(context, token, 'DELETE', path, caseName),

    raw: async (path: string, init: RequestInit, caseName: string) => {
      const url = `${context.baseUrl}${path}`
      const headers = buildHeaders(context, token, caseName)
      return fetch(url, {
        ...init,
        headers: { ...headers, ...(init.headers as Record<string, string> | undefined) }
      })
    }
  }
}
