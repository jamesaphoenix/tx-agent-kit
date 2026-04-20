// @vitest-environment jsdom

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Dialog, DialogContent, DialogTitle } from './dialog'

afterEach(() => {
  cleanup()
})

describe('Dialog', () => {
  it('closes when Escape is pressed while open', async () => {
    const onOpenChange = vi.fn()
    const user = userEvent.setup()

    render(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent aria-label="Example dialog">
          <DialogTitle>Example dialog</DialogTitle>
        </DialogContent>
      </Dialog>
    )

    await user.keyboard('{Escape}')

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('closes when the close button is clicked', async () => {
    const onOpenChange = vi.fn()
    const user = userEvent.setup()

    render(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent aria-label="Example dialog">
          <DialogTitle>Example dialog</DialogTitle>
        </DialogContent>
      </Dialog>
    )

    await user.click(screen.getByRole('button', { name: /close/i }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
