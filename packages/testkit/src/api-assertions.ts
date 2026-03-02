import { expect } from 'vitest'
import * as Schema from 'effect/Schema'

export interface ApiResult<T = unknown> {
  response: Response
  body: T
}

export interface ApiErrorBody {
  message: string
  [key: string]: unknown
}

export interface PaginatedBody<T = unknown> {
  data: T[]
  total: number
  nextCursor: string | null
  prevCursor: string | null
}

const isSuccessStatus = (status: number): boolean => status >= 200 && status < 300

const formatFailure = (label: string, result: ApiResult, detail?: string): string => {
  const parts = [
    `${label}: expected success but got status ${result.response.status}`,
    detail,
    JSON.stringify(result.body)
  ]
  return parts.filter(Boolean).join(' — ')
}

export const expectApiSuccess = <T = unknown>(
  result: ApiResult<T>,
  expectedStatus?: number
): T => {
  if (expectedStatus !== undefined) {
    expect(
      result.response.status,
      `Expected status ${expectedStatus}, got ${result.response.status}`
    ).toBe(expectedStatus)
  } else {
    expect(
      isSuccessStatus(result.response.status),
      formatFailure('expectApiSuccess', result)
    ).toBe(true)
  }
  return result.body
}

export const expectApiSuccessWithSchema = <A, I>(
  result: ApiResult,
  schema: Schema.Schema<A, I>,
  expectedStatus?: number
): A => {
  expectApiSuccess(result, expectedStatus)
  try {
    return Schema.decodeUnknownSync(schema)(result.body)
  } catch (error) {
    throw new Error(`Response body did not match schema: ${String(error)}`)
  }
}

export const expectApiError = (
  result: ApiResult,
  expectedStatus: number,
  messageContains?: string
): ApiErrorBody => {
  expect(
    result.response.status,
    `Expected error status ${expectedStatus}, got ${result.response.status}`
  ).toBe(expectedStatus)

  const body = result.body as ApiErrorBody
  expect(body).toHaveProperty('message')

  if (messageContains !== undefined) {
    expect(
      body.message,
      `Expected error message to contain "${messageContains}", got "${body.message}"`
    ).toContain(messageContains)
  }

  return body
}

export const expectApiList = <T = unknown>(
  result: ApiResult,
  expectedLength?: number,
  expectedStatus?: number
): PaginatedBody<T> => {
  const status = expectedStatus ?? 200
  expect(
    result.response.status,
    `Expected status ${status}, got ${result.response.status}`
  ).toBe(status)

  const body = result.body as PaginatedBody<T>
  expect(body).toHaveProperty('data')
  expect(body).toHaveProperty('total')
  expect(Array.isArray(body.data), 'Expected body.data to be an array').toBe(true)

  if (expectedLength !== undefined) {
    expect(
      body.data.length,
      `Expected ${expectedLength} items in list, got ${body.data.length}`
    ).toBe(expectedLength)
  }

  return body
}

export const expectUnauthorized = (
  result: ApiResult,
  messageContains?: string
): ApiErrorBody => expectApiError(result, 401, messageContains)

export const expectNotFound = (
  result: ApiResult,
  messageContains?: string
): ApiErrorBody => expectApiError(result, 404, messageContains)

export const expectConflict = (
  result: ApiResult,
  messageContains?: string
): ApiErrorBody => expectApiError(result, 409, messageContains)
