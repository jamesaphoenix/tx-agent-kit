import {
  LangfuseSpanProcessor,
  isDefaultExportSpan,
  type MaskFunction,
  type ShouldExportSpan
} from '@langfuse/otel'
import type {
  ReadableSpan,
  SpanProcessor
} from '@opentelemetry/sdk-trace-base'

import type { LangfuseEnv } from './env.js'

const maxUint32 = 4_294_967_295

const secretPatterns = [
  /\bsk-lf-[A-Za-z0-9-]+\b/g,
  /\bsk-or-[A-Za-z0-9_-]+\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]+\b/g,
  /\bBasic\s+[A-Za-z0-9+/=:_-]+/g
]

const maskString = (value: string): string =>
  secretPatterns.reduce(
    (masked, pattern) => masked.replace(pattern, '[REDACTED]'),
    value
  )

const maskUnknown = (value: unknown): unknown => {
  if (typeof value === 'string') {
    return maskString(value)
  }

  if (Array.isArray(value)) {
    return value.map(maskUnknown)
  }

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, maskUnknown(child)])
    )
  }

  return value
}

export const maskLangfuseData: MaskFunction = ({ data }: { data: unknown }) =>
  maskUnknown(data)

const traceSampleRatio = (span: ReadableSpan): number => {
  const traceId = span.spanContext().traceId
  if (!/^[a-f0-9]{32}$/i.test(traceId)) {
    return 0
  }

  return Number.parseInt(traceId.slice(0, 8), 16) / maxUint32
}

const shouldSampleTrace = (
  span: ReadableSpan,
  sampleRate: number
): boolean => {
  if (sampleRate >= 1) {
    return true
  }

  if (sampleRate <= 0) {
    return false
  }

  return traceSampleRatio(span) < sampleRate
}

export const createLangfuseShouldExportSpan = (
  sampleRate: number
): ShouldExportSpan => ({ otelSpan }) =>
  isDefaultExportSpan(otelSpan) && shouldSampleTrace(otelSpan, sampleRate)

export const createLangfuseSpanProcessor = (
  env: LangfuseEnv
): SpanProcessor | null => {
  if (!env.enabled) {
    return null
  }

  return new LangfuseSpanProcessor({
    publicKey: env.publicKey,
    secretKey: env.secretKey,
    baseUrl: env.baseUrl,
    environment: env.environment,
    ...(env.release ? { release: env.release } : {}),
    mask: maskLangfuseData,
    shouldExportSpan: createLangfuseShouldExportSpan(env.sampleRate)
  })
}
