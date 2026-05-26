import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { shouldRecordHttpVcr } from './env.js'

export type HttpVcrMode = 'replay' | 'record'

export interface HttpVcrRequestSnapshot {
  readonly method: string
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  readonly bodyHash: string | null
  readonly body: unknown
}

export interface HttpVcrResponseSnapshot {
  readonly status: number
  readonly statusText: string
  readonly headers: Readonly<Record<string, string>>
  readonly bodyText: string | null
  readonly bodyBase64: string | null
}

export interface HttpVcrInteraction {
  readonly key: string
  readonly request: HttpVcrRequestSnapshot
  readonly response: HttpVcrResponseSnapshot
  readonly recordedAt: string
}

export interface HttpVcrCassette {
  readonly version: 1
  readonly interactions: ReadonlyArray<HttpVcrInteraction>
}

export interface CreateHttpVcrFetchOptions {
  readonly cassettePath: string
  readonly mode?: HttpVcrMode
  readonly fetchImpl?: typeof fetch
}

const secretKeyPattern = new RegExp(
  [
    'authorization',
    'cookie',
    'token',
    'secret',
    'password',
    'credential',
    'client_secret',
    'code_verifier',
    'api[_-]?key',
    'refresh[_-]?token',
    'access[_-]?token'
  ].join('|'),
  'iu'
)
const redacted = '[REDACTED]'

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
  return `{${entries.join(',')}}`
}

export const stableHttpVcrHash = (value: unknown): string =>
  createHash('sha256').update(stableStringify(value)).digest('hex')

const redact = (value: unknown, keyHint = ''): unknown => {
  if (secretKeyPattern.test(keyHint)) {
    return redacted
  }
  if (value === null || value === undefined) {
    return value
  }
  if (typeof value === 'string') {
    if (/^(?:bearer|basic)\s+/iu.test(value)) {
      return redacted
    }
    return value
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'bigint') {
    return value.toString()
  }
  if (typeof value === 'symbol') {
    return value.description ?? '[symbol]'
  }
  if (typeof value === 'function') {
    return '[function]'
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redact(entry, keyHint))
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        redact(entry, key)
      ])
    )
  }
  return '[unsupported]'
}

const parseBodyText = (text: string): unknown => {
  try {
    return redact(JSON.parse(text))
  } catch {
    return redact(text)
  }
}

const headersToRecord = (headers: Headers): Record<string, string> => {
  const out: Record<string, string> = {}
  headers.forEach((value, key) => {
    const lowerKey = key.toLowerCase()
    out[lowerKey] = String(redact(value, lowerKey))
  })
  return Object.fromEntries(
    Object.entries(out).sort(([left], [right]) => left.localeCompare(right))
  )
}

const scrubUrl = (rawUrl: string): string => {
  const parsed = new URL(rawUrl)
  const entries = Array.from(parsed.searchParams.entries()).sort(
    ([left], [right]) => left.localeCompare(right)
  )
  parsed.search = ''
  for (const [key, value] of entries) {
    parsed.searchParams.append(key, String(redact(value, key)))
  }
  return parsed.toString()
}

const bodyToSnapshot = async (
  input: RequestInfo | URL,
  init: RequestInit | undefined
): Promise<{ readonly bodyHash: string | null; readonly body: unknown }> => {
  const initBody = init?.body
  if (typeof initBody === 'string') {
    const body = parseBodyText(initBody)
    return { bodyHash: stableHttpVcrHash(body), body }
  }
  if (initBody instanceof URLSearchParams) {
    const body = Object.fromEntries(
      Array.from(initBody.entries()).map(([key, value]) => [
        key,
        redact(value, key)
      ])
    )
    return { bodyHash: stableHttpVcrHash(body), body }
  }
  if (initBody instanceof FormData) {
    const body: Record<string, unknown> = {}
    initBody.forEach((value, key) => {
      body[key] =
        typeof value === 'string'
          ? redact(value, key)
          : {
              file: true,
              name: value.name,
              type: value.type,
              size: value.size
            }
    })
    return { bodyHash: stableHttpVcrHash(body), body }
  }
  if (initBody instanceof Blob) {
    const body = { binary: true, type: initBody.type, size: initBody.size }
    return { bodyHash: stableHttpVcrHash(body), body }
  }
  if (initBody instanceof ArrayBuffer) {
    const digest = createHash('sha256').update(new Uint8Array(initBody)).digest('hex')
    const body = { binary: true, sha256: digest, size: initBody.byteLength }
    return { bodyHash: stableHttpVcrHash(body), body }
  }
  if (ArrayBuffer.isView(initBody)) {
    const bytes = new Uint8Array(
      initBody.buffer,
      initBody.byteOffset,
      initBody.byteLength
    )
    const digest = createHash('sha256').update(bytes).digest('hex')
    const body = { binary: true, sha256: digest, size: bytes.byteLength }
    return { bodyHash: stableHttpVcrHash(body), body }
  }
  if (initBody !== undefined && initBody !== null) {
    const body = { unsupportedBodyType: Object.prototype.toString.call(initBody) }
    return { bodyHash: stableHttpVcrHash(body), body }
  }
  if (input instanceof Request) {
    const text = await input.clone().text()
    if (text.length > 0) {
      const body = parseBodyText(text)
      return { bodyHash: stableHttpVcrHash(body), body }
    }
  }
  return { bodyHash: null, body: null }
}

const requestToSnapshot = async (
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<HttpVcrRequestSnapshot> => {
  const request = new Request(input, init)
  const body = await bodyToSnapshot(input, init)
  return {
    method: request.method.toUpperCase(),
    url: scrubUrl(request.url),
    headers: headersToRecord(request.headers),
    bodyHash: body.bodyHash,
    body: body.body
  }
}

const responseToSnapshot = async (
  response: Response
): Promise<HttpVcrResponseSnapshot> => {
  const headers = headersToRecord(response.headers)
  const contentType = response.headers.get('content-type') ?? ''
  const bytes = new Uint8Array(await response.clone().arrayBuffer())
  const isText =
    contentType.startsWith('application/json') ||
    contentType.startsWith('text/') ||
    contentType.includes('+json')

  if (isText) {
    const text = Buffer.from(bytes).toString('utf8')
    const parsedBody = redact(parseBodyText(text))
    return {
      status: response.status,
      statusText: response.statusText,
      headers,
      bodyText:
        typeof parsedBody === 'string' ? parsedBody : JSON.stringify(parsedBody),
      bodyBase64: null
    }
  }

  return {
    status: response.status,
    statusText: response.statusText,
    headers,
    bodyText: null,
    bodyBase64: Buffer.from(bytes).toString('base64')
  }
}

const responseFromSnapshot = (snapshot: HttpVcrResponseSnapshot): Response => {
  const body = snapshot.bodyBase64 !== null
    ? Buffer.from(snapshot.bodyBase64, 'base64')
    : snapshot.bodyText
  return new Response(body, {
    status: snapshot.status,
    statusText: snapshot.statusText,
    headers: snapshot.headers
  })
}

const readCassette = async (cassettePath: string): Promise<HttpVcrCassette> => {
  try {
    const raw = await readFile(cassettePath, 'utf8')
    const parsed = JSON.parse(raw) as Partial<HttpVcrCassette>
    return {
      version: 1,
      interactions: parsed.interactions ?? []
    }
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return { version: 1, interactions: [] }
    }
    throw error
  }
}

const writeCassette = async (
  cassettePath: string,
  cassette: HttpVcrCassette
): Promise<void> => {
  await mkdir(dirname(cassettePath), { recursive: true })
  await writeFile(cassettePath, `${JSON.stringify(cassette, null, 2)}\n`)
}

const resolveMode = (mode: HttpVcrMode | undefined): HttpVcrMode => {
  if (mode) {
    return mode
  }
  if (shouldRecordHttpVcr()) {
    return 'record'
  }
  return 'replay'
}

export const createHttpVcrFetch = (
  options: CreateHttpVcrFetchOptions
): typeof fetch => {
  const mode = resolveMode(options.mode)
  const realFetch = options.fetchImpl ?? fetch
  let cassettePromise: Promise<HttpVcrCassette> | null = null
  const replayCursors = new Map<string, number>()

  const load = (): Promise<HttpVcrCassette> => {
    cassettePromise ??= readCassette(options.cassettePath)
    return cassettePromise
  }

  return async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    const request = await requestToSnapshot(input, init)
    const key = stableHttpVcrHash(request)
    const cassette = await load()

    if (mode === 'replay') {
      const index = replayCursors.get(key) ?? 0
      const matches = cassette.interactions.filter((entry) => entry.key === key)
      const match = matches[index]
      if (!match) {
        throw new Error(`HTTP VCR cassette miss for ${request.method} ${request.url}`)
      }
      replayCursors.set(key, index + 1)
      return responseFromSnapshot(match.response)
    }

    const response = await realFetch(input, init)
    const interaction: HttpVcrInteraction = {
      key,
      request,
      response: await responseToSnapshot(response),
      recordedAt: new Date().toISOString()
    }
    const nextCassette = {
      version: 1 as const,
      interactions: [...cassette.interactions, interaction]
    }
    cassettePromise = Promise.resolve(nextCassette)
    await writeCassette(options.cassettePath, nextCassette)
    return response
  }
}
