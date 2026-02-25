import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  _resetMetricsRegistryForTest,
  getOrCreateHttpClientMetrics,
  getOrCreateNodeServiceMetrics,
  httpClientRequestCountMetricName,
  httpClientRequestDurationMetricName,
  nodeServiceStartupMetricName
} from './metrics-registry.js'

describe('metrics registry', () => {
  beforeEach(() => {
    _resetMetricsRegistryForTest()
  })

  it('creates and caches HTTP client instruments per meter', () => {
    const createCounterMock = vi.fn(() => ({ add: vi.fn() }))
    const createHistogramMock = vi.fn(() => ({ record: vi.fn() }))
    const meter = {
      createCounter: createCounterMock,
      createHistogram: createHistogramMock
    }

    const first = getOrCreateHttpClientMetrics(meter)
    const second = getOrCreateHttpClientMetrics(meter)

    expect(first).toBe(second)
    expect(createCounterMock).toHaveBeenCalledTimes(1)
    expect(createCounterMock).toHaveBeenCalledWith(
      httpClientRequestCountMetricName,
      expect.objectContaining({
        unit: '{request}'
      })
    )
    expect(createHistogramMock).toHaveBeenCalledTimes(1)
    expect(createHistogramMock).toHaveBeenCalledWith(
      httpClientRequestDurationMetricName,
      expect.objectContaining({
        unit: 'ms'
      })
    )
  })

  it('creates and caches node service startup counter per meter', () => {
    const createCounterMock = vi.fn(() => ({ add: vi.fn() }))
    const meter = {
      createCounter: createCounterMock
    }

    const first = getOrCreateNodeServiceMetrics(meter)
    const second = getOrCreateNodeServiceMetrics(meter)

    expect(first).toBe(second)
    expect(createCounterMock).toHaveBeenCalledTimes(1)
    expect(createCounterMock).toHaveBeenCalledWith(
      nodeServiceStartupMetricName,
      expect.objectContaining({
        unit: '{startup}'
      })
    )
  })
})
