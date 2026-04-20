import { afterEach, describe, expect, it } from 'vitest'
import {
  getClientObservabilityEnv,
  getObservabilityEnv
} from './env.js'

const originalEnvSnapshot = { ...process.env }

const resetObservedEnvKeys = () => {
  delete process.env.NODE_ENV
  delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  delete process.env.OTEL_LOG_LEVEL
  delete process.env.OTEL_LOGS_EXPORTER
  delete process.env.LANGFUSE_ENABLED
  delete process.env.LANGFUSE_BASE_URL
  delete process.env.LANGFUSE_HOST
  delete process.env.LANGFUSE_PUBLIC_KEY
  delete process.env.LANGFUSE_SECRET_KEY
  delete process.env.LANGFUSE_SAMPLE_RATE
  delete process.env.LANGFUSE_LOG_LEVEL
  delete process.env.LANGFUSE_TRACING_ENVIRONMENT
  delete process.env.LANGFUSE_RELEASE
  delete process.env.NEXT_PUBLIC_OTEL_EXPORTER_OTLP_ENDPOINT
  delete process.env.EXPO_PUBLIC_OTEL_EXPORTER_OTLP_ENDPOINT
  delete process.env.NEXT_PUBLIC_NODE_ENV
  delete process.env.EXPO_PUBLIC_NODE_ENV
}

afterEach(() => {
  process.env = { ...originalEnvSnapshot }
})

describe('getObservabilityEnv', () => {
  it('returns defaults when env variables are unset', () => {
    resetObservedEnvKeys()

    expect(getObservabilityEnv()).toEqual({
      OTEL_LOG_LEVEL: undefined,
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4320',
      OTEL_LOGS_EXPORTER: 'otlp',
      NODE_ENV: 'development',
      LANGFUSE: {
        enabled: false,
        baseUrl: 'http://localhost:3003',
        publicKey: '',
        secretKey: '',
        sampleRate: 1,
        logLevel: 'WARN',
        environment: 'development',
        release: undefined
      }
    })
  })

  it('returns explicit env overrides when provided', () => {
    process.env.NODE_ENV = 'production'
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://otel.example:4318'
    process.env.OTEL_LOG_LEVEL = 'DEBUG'
    process.env.OTEL_LOGS_EXPORTER = 'none'
    process.env.LANGFUSE_ENABLED = 'true'
    process.env.LANGFUSE_BASE_URL = 'https://us.cloud.langfuse.com'
    process.env.LANGFUSE_PUBLIC_KEY = 'pk-lf-test'
    process.env.LANGFUSE_SECRET_KEY = 'sk-lf-test'
    process.env.LANGFUSE_SAMPLE_RATE = '0.5'
    process.env.LANGFUSE_LOG_LEVEL = 'debug'
    process.env.LANGFUSE_TRACING_ENVIRONMENT = 'prod'
    process.env.LANGFUSE_RELEASE = 'sha-123'

    expect(getObservabilityEnv()).toEqual({
      OTEL_LOG_LEVEL: 'debug',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://otel.example:4318',
      OTEL_LOGS_EXPORTER: 'none',
      NODE_ENV: 'production',
      LANGFUSE: {
        enabled: true,
        baseUrl: 'https://us.cloud.langfuse.com',
        publicKey: 'pk-lf-test',
        secretKey: 'sk-lf-test',
        sampleRate: 0.5,
        logLevel: 'DEBUG',
        environment: 'prod',
        release: 'sha-123'
      }
    })
  })

  it('falls back from LANGFUSE_BASE_URL to legacy LANGFUSE_HOST', () => {
    resetObservedEnvKeys()
    process.env.LANGFUSE_HOST = 'https://legacy-host.example'

    expect(getObservabilityEnv().LANGFUSE.baseUrl).toBe(
      'https://legacy-host.example'
    )
  })

  it('requires keys when Langfuse export is enabled', () => {
    resetObservedEnvKeys()
    process.env.LANGFUSE_ENABLED = 'true'

    expect(() => getObservabilityEnv()).toThrow(
      'LANGFUSE_ENABLED=true requires LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY'
    )
  })

  it('validates Langfuse sample rate bounds', () => {
    resetObservedEnvKeys()
    process.env.LANGFUSE_SAMPLE_RATE = '2'

    expect(() => getObservabilityEnv()).toThrow(
      'LANGFUSE_SAMPLE_RATE must be a number between 0 and 1'
    )
  })
})

describe('getClientObservabilityEnv', () => {
  it('uses client defaults when env values are unset', () => {
    resetObservedEnvKeys()

    expect(getClientObservabilityEnv()).toEqual({
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4320',
      NODE_ENV: 'development'
    })
  })

  it('prefers NEXT_PUBLIC client env values', () => {
    resetObservedEnvKeys()
    process.env.NEXT_PUBLIC_OTEL_EXPORTER_OTLP_ENDPOINT = 'https://next-public-otel.example'
    process.env.NEXT_PUBLIC_NODE_ENV = 'staging'

    expect(getClientObservabilityEnv()).toEqual({
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://next-public-otel.example',
      NODE_ENV: 'staging'
    })
  })

  it('falls back to EXPO_PUBLIC then OTEL_EXPORTER_OTLP_ENDPOINT', () => {
    resetObservedEnvKeys()
    process.env.EXPO_PUBLIC_OTEL_EXPORTER_OTLP_ENDPOINT = 'https://expo-public-otel.example'
    process.env.EXPO_PUBLIC_NODE_ENV = 'preview'

    expect(getClientObservabilityEnv()).toEqual({
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://expo-public-otel.example',
      NODE_ENV: 'preview'
    })

    resetObservedEnvKeys()
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://shared-otel.example'
    process.env.NODE_ENV = 'test'

    expect(getClientObservabilityEnv()).toEqual({
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://shared-otel.example',
      NODE_ENV: 'test'
    })
  })
})
