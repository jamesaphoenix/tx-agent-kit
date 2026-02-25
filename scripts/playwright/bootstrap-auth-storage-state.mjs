#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'

const AUTH_TOKEN_STORAGE_KEY = 'tx-agent-kit.auth-token'
const DEFAULT_SITE_URL = 'http://localhost:3000'
const DEFAULT_API_BASE_URL = 'http://localhost:4000'
const DEFAULT_STORAGE_STATE_PATH = '.artifacts/playwright-mcp/storage-state.json'
const DEFAULT_AUTH_NAME = 'Playwright MCP User'

const asBoolean = (value, fallback = false) => {
  if (value === undefined) {
    return fallback
  }

  const normalized = value.toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false
  }

  throw new Error(`Invalid boolean value "${value}"`)
}

const trimTrailingSlash = (value) => value.replace(/\/+$/u, '')

const assertUrl = (value, label) => {
  try {
    return new URL(value)
  } catch {
    throw new Error(`${label} must be a valid URL. Received "${value}"`)
  }
}

const buildUrl = (baseUrl, path) => new URL(path, `${baseUrl}/`).toString()

const parseJson = (raw) => {
  if (raw.trim().length === 0) {
    return null
  }

  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

const getErrorMessage = (payload, fallback) => {
  if (!payload || typeof payload !== 'object') {
    return fallback
  }

  if ('message' in payload && typeof payload.message === 'string' && payload.message.length > 0) {
    return payload.message
  }

  if (
    'error' in payload &&
    payload.error &&
    typeof payload.error === 'object' &&
    'message' in payload.error &&
    typeof payload.error.message === 'string' &&
    payload.error.message.length > 0
  ) {
    return payload.error.message
  }

  return fallback
}

const requestJson = async (url, init) => {
  const response = await fetch(url, init)
  const raw = await response.text()
  const payload = parseJson(raw)
  return { response, payload }
}

const canIgnoreSignUpFailure = (status, message) => {
  if (status === 409) {
    return true
  }

  if (status !== 400) {
    return false
  }

  return /(already|exists|have an account|registered)/iu.test(message)
}

const main = async () => {
  const nodeEnv = process.env.NODE_ENV ?? 'development'
  const allowProd = asBoolean(process.env.PLAYWRIGHT_AUTH_ALLOW_PROD, false)
  if (nodeEnv === 'production' && !allowProd) {
    throw new Error(
      'Refusing to bootstrap Playwright auth in production. Set PLAYWRIGHT_AUTH_ALLOW_PROD=true to override.'
    )
  }

  const email = process.env.PLAYWRIGHT_AUTH_EMAIL
  const password = process.env.PLAYWRIGHT_AUTH_PASSWORD
  const name = process.env.PLAYWRIGHT_AUTH_NAME ?? DEFAULT_AUTH_NAME
  const siteUrl = process.env.PLAYWRIGHT_AUTH_SITE_URL ?? DEFAULT_SITE_URL
  const apiBaseUrl = trimTrailingSlash(process.env.PLAYWRIGHT_AUTH_API_BASE_URL ?? process.env.API_BASE_URL ?? DEFAULT_API_BASE_URL)
  const storageStatePath = resolve(process.cwd(), process.env.PLAYWRIGHT_MCP_STORAGE_STATE ?? DEFAULT_STORAGE_STATE_PATH)

  if (!email || !password) {
    throw new Error(
      'PLAYWRIGHT_AUTH_EMAIL and PLAYWRIGHT_AUTH_PASSWORD are required. ' +
        'Tip: op run --env-file=.env.playwright.dev -- pnpm mcp:playwright:auth'
    )
  }

  const siteOrigin = assertUrl(siteUrl, 'PLAYWRIGHT_AUTH_SITE_URL').origin
  assertUrl(apiBaseUrl, 'PLAYWRIGHT_AUTH_API_BASE_URL')

  const signUpUrl = buildUrl(apiBaseUrl, '/v1/auth/sign-up')
  const signInUrl = buildUrl(apiBaseUrl, '/v1/auth/sign-in')
  const meUrl = buildUrl(apiBaseUrl, '/v1/auth/me')

  const commonHeaders = {
    'content-type': 'application/json'
  }

  const signUp = await requestJson(signUpUrl, {
    method: 'POST',
    headers: commonHeaders,
    body: JSON.stringify({ email, password, name })
  })

  if (!signUp.response.ok) {
    const message = getErrorMessage(signUp.payload, 'Failed to sign up bootstrap user')
    if (!canIgnoreSignUpFailure(signUp.response.status, message)) {
      throw new Error(`Sign-up failed (${signUp.response.status}): ${message}`)
    }
  }

  const signIn = await requestJson(signInUrl, {
    method: 'POST',
    headers: commonHeaders,
    body: JSON.stringify({ email, password })
  })

  if (!signIn.response.ok) {
    const message = getErrorMessage(signIn.payload, 'Failed to sign in bootstrap user')
    throw new Error(`Sign-in failed (${signIn.response.status}): ${message}`)
  }

  const token =
    signIn.payload && typeof signIn.payload === 'object' && 'token' in signIn.payload && typeof signIn.payload.token === 'string'
      ? signIn.payload.token
      : null

  if (!token) {
    throw new Error('Sign-in response did not contain a token')
  }

  const me = await requestJson(meUrl, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${token}`
    }
  })

  if (!me.response.ok) {
    const message = getErrorMessage(me.payload, 'Failed to validate bootstrap session')
    throw new Error(`Session validation failed (${me.response.status}): ${message}`)
  }

  const storageState = {
    cookies: [],
    origins: [
      {
        origin: siteOrigin,
        localStorage: [
          {
            name: AUTH_TOKEN_STORAGE_KEY,
            value: token
          }
        ]
      }
    ]
  }

  await mkdir(dirname(storageStatePath), { recursive: true })
  await writeFile(storageStatePath, `${JSON.stringify(storageState, null, 2)}\n`, 'utf8')

  console.log(`Playwright auth storage state written to ${storageStatePath}`)
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`playwright auth bootstrap failed: ${message}`)
  process.exitCode = 1
})
