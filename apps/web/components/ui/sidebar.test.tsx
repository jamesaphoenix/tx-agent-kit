// @vitest-environment jsdom

import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SidebarProvider, useSidebar } from './sidebar'

function SidebarStateProbe() {
  const { open } = useSidebar()
  return <div data-testid="sidebar-state">{open ? 'open' : 'closed'}</div>
}

describe('SidebarProvider', () => {
  it('does not register a global keyboard shortcut', async () => {
    const onOpenChange = vi.fn()
    const user = userEvent.setup()

    const { getByTestId } = render(
      <SidebarProvider open onOpenChange={onOpenChange}>
        <SidebarStateProbe />
      </SidebarProvider>
    )

    expect(getByTestId('sidebar-state').textContent).toBe('open')

    await user.keyboard('{Meta>}b{/Meta}')
    await user.keyboard('{Control>}b{/Control}')

    expect(onOpenChange).not.toHaveBeenCalled()
    expect(getByTestId('sidebar-state').textContent).toBe('open')
  })
})
