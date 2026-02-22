import { describe, expect, it } from 'vitest'
import { verifyTemporalTypes } from './verify-temporal-types.ts'

describe('verify-temporal-types', () => {
  it('passes when worker workflow input/output types are exported from temporal client', () => {
    const result = verifyTemporalTypes()
    expect(result.success).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.missingTypes).toEqual([])
  })

  it('detects at least one workflow in worker source', () => {
    const result = verifyTemporalTypes()
    expect(result.workflows.length).toBeGreaterThan(0)
  })

  it('ensures discovered workflows use named output types', () => {
    const result = verifyTemporalTypes()
    for (const workflow of result.workflows) {
      expect(workflow.outputType).toMatch(/^[A-Z]\w+$/)
    }
  })

  it('ensures discovered workflows use named input types or no input', () => {
    const result = verifyTemporalTypes()
    for (const workflow of result.workflows) {
      if (workflow.inputType) {
        expect(workflow.inputType).toMatch(/^[A-Z]\w+$/)
      }
    }
  })

  it('returns file metadata for each discovered workflow', () => {
    const result = verifyTemporalTypes()
    for (const workflow of result.workflows) {
      expect(workflow.file).toContain('apps/worker/src')
      expect(workflow.name.endsWith('Workflow')).toBe(true)
    }
  })
})
