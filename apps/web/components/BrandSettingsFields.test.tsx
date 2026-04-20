// @vitest-environment jsdom

import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { BrandSettingsFields, defaultBrandSettingsValues } from './BrandSettingsFields'

describe('BrandSettingsFields', () => {
  it('uses a pointer cursor for the industry select control', () => {
    const { container } = render(
      <BrandSettingsFields
        values={defaultBrandSettingsValues}
        onChange={vi.fn()}
      />
    )

    const control = container.querySelector<HTMLElement>('.brand-industry-select__control')

    expect(control).not.toBeNull()
    expect(control?.className).toContain('cursor-pointer')
  })
})
