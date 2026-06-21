import type { Meter } from '@opentelemetry/api'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  _resetValidationMetricsRegistryForTest,
  apiRequestValidationRejectedMetricName,
  getOrCreateValidationMetrics
} from './validation-metrics.js'

describe('validation metrics', () => {
  beforeEach(() => {
    _resetValidationMetricsRegistryForTest()
  })

  it('creates and caches the rejection counter per meter', () => {
    const createCounterMock = vi.fn(() => ({ add: vi.fn() }))
    const meter = { createCounter: createCounterMock } as unknown as Meter

    const first = getOrCreateValidationMetrics(meter)
    const second = getOrCreateValidationMetrics(meter)

    expect(first).toBe(second)
    expect(createCounterMock).toHaveBeenCalledTimes(1)
    expect(createCounterMock).toHaveBeenCalledWith(
      apiRequestValidationRejectedMetricName,
      expect.objectContaining({ unit: '{rejection}' })
    )
  })

  it('records a rejection with low-cardinality operation/field/authenticated labels', () => {
    const addMock = vi.fn()
    const meter = { createCounter: vi.fn(() => ({ add: addMock })) } as unknown as Meter

    const metrics = getOrCreateValidationMetrics(meter)
    metrics.rejectionCounter.add(1, {
      operation_id: 'teams.listTeams',
      field: 'organizationId',
      authenticated: 'true'
    })

    expect(addMock).toHaveBeenCalledWith(1, {
      operation_id: 'teams.listTeams',
      field: 'organizationId',
      authenticated: 'true'
    })
  })
})
