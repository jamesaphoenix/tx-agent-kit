// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import GlobalError from './global-error'

const { reportWebErrorMock } = vi.hoisted(() => ({
  reportWebErrorMock: vi.fn<(error: unknown) => Promise<boolean>>().mockResolvedValue(true)
}))

vi.mock('@/lib/sentry', () => ({
  reportWebError: reportWebErrorMock
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('GlobalError', () => {
  it('renders the fallback UI and reports the caught error to Sentry', async () => {
    const error = Object.assign(new Error('render crash'), { digest: 'abc123' })

    render(<GlobalError error={error} reset={() => undefined} />)

    expect(screen.queryByText('Something went wrong')).not.toBeNull()
    expect(screen.queryByText('Reference: abc123')).not.toBeNull()
    await waitFor(() => {
      expect(reportWebErrorMock).toHaveBeenCalledWith(error)
    })
  })

  it('invokes reset when Try again is clicked', async () => {
    const reset = vi.fn()
    render(<GlobalError error={new Error('boom')} reset={reset} />)

    screen.getByRole('button', { name: 'Try again' }).click()

    expect(reset).toHaveBeenCalledTimes(1)
    await waitFor(() => {
      expect(reportWebErrorMock).toHaveBeenCalled()
    })
  })
})
