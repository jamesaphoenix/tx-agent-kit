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
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
      NODE_ENV: 'development'
    })
  })

  it('returns explicit env overrides when provided', () => {
    process.env.NODE_ENV = 'production'
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://otel.example:4318'
    process.env.OTEL_LOG_LEVEL = 'debug'

    expect(getObservabilityEnv()).toEqual({
      OTEL_LOG_LEVEL: 'debug',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://otel.example:4318',
      NODE_ENV: 'production'
    })
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
