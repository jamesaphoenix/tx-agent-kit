// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { PageLoadingSpinner } from './PageLoadingSpinner'

afterEach(() => {
  cleanup()
})

describe('PageLoadingSpinner', () => {
  it('renders an accessible loading status', () => {
    render(<PageLoadingSpinner label="Preparing route" />)

    expect(screen.queryByRole('status', { name: 'Preparing route' })).not.toBeNull()
  })
})
