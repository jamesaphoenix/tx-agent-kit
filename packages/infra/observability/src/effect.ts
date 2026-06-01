import type * as OtelApi from '@opentelemetry/api'
import * as EffectOtelResource from '@effect/opentelemetry/Resource'
import * as EffectOtelTracer from '@effect/opentelemetry/Tracer'
import { makeEffectLoggerLayer } from '@tx-agent-kit/logging'
import { Layer } from 'effect'

export interface EffectOtelLayerConfig {
  serviceName: string
  serviceVersion?: string
  resourceAttributes?: OtelApi.Attributes
}

export interface EffectOtelResourceConfig {
  serviceName: string
  serviceVersion?: string
  attributes?: OtelApi.Attributes
}

export const makeEffectOtelResourceConfig = (
  config: EffectOtelLayerConfig
): EffectOtelResourceConfig => {
  const attributes = config.resourceAttributes ?? {}

  return {
    serviceName: config.serviceName,
    ...(config.serviceVersion ? { serviceVersion: config.serviceVersion } : {}),
    ...(Object.keys(attributes).length > 0 ? { attributes } : {})
  }
}

export const makeEffectOtelLayer = (config: EffectOtelLayerConfig) =>
  // Tracer (global span registration) + the Effect→createLogger bridge, so
  // every Effect.log* in domain code is structured + OTEL-exported + trace-
  // correlated, consistent with createLogger. Both are Layer<never>; merging is
  // additive and leaves the tracer behavior untouched.
  Layer.merge(
    Layer.provide(
      EffectOtelTracer.layerGlobal,
      EffectOtelResource.layer(makeEffectOtelResourceConfig(config))
    ),
    makeEffectLoggerLayer(config.serviceName)
  )

export const withEffectSpanContext = EffectOtelTracer.withSpanContext
