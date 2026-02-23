import { describe, expect, it } from 'vitest'
import { getObservabilityEnv } from './env.js'

describe('getObservabilityEnv', () => {
  it('returns defaults when env variables are unset', () => {
    const originalNodeEnv = process.env.NODE_ENV
    const originalEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
    const originalLogLevel = process.env.OTEL_LOG_LEVEL

    delete process.env.NODE_ENV
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT
    delete process.env.OTEL_LOG_LEVEL

    try {
      expect(getObservabilityEnv()).toEqual({
        OTEL_LOG_LEVEL: undefined,
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
        NODE_ENV: 'development'
      })
    } finally {
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV
      } else {
        process.env.NODE_ENV = originalNodeEnv
      }

      if (originalEndpoint === undefined) {
        delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT
      } else {
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT = originalEndpoint
      }

      if (originalLogLevel === undefined) {
        delete process.env.OTEL_LOG_LEVEL
      } else {
        process.env.OTEL_LOG_LEVEL = originalLogLevel
      }
    }
  })

  it('returns explicit env overrides when provided', () => {
    const originalNodeEnv = process.env.NODE_ENV
    const originalEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
    const originalLogLevel = process.env.OTEL_LOG_LEVEL

    process.env.NODE_ENV = 'production'
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://otel.example:4318'
    process.env.OTEL_LOG_LEVEL = 'debug'

    try {
      expect(getObservabilityEnv()).toEqual({
        OTEL_LOG_LEVEL: 'debug',
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://otel.example:4318',
        NODE_ENV: 'production'
      })
    } finally {
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV
      } else {
        process.env.NODE_ENV = originalNodeEnv
      }

      if (originalEndpoint === undefined) {
        delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT
      } else {
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT = originalEndpoint
      }

      if (originalLogLevel === undefined) {
        delete process.env.OTEL_LOG_LEVEL
      } else {
        process.env.OTEL_LOG_LEVEL = originalLogLevel
      }
    }
  })
})
