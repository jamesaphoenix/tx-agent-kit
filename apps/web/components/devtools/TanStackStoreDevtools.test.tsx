// @vitest-environment jsdom
import { Store } from '@tanstack/react-store'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { TanStackStoreDevtools, formatStoreSnapshot } from './TanStackStoreDevtools'

interface CounterState {
  count: number
  label: string
}

const createCounterStore = (initialCount: number, label: string): Store<CounterState> => {
  return new Store<CounterState>({
    count: initialCount,
    label
  })
}

describe('TanStackStoreDevtools', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders current snapshot and initial history when opened', () => {
    const store = createCounterStore(0, 'initial')

    render(<TanStackStoreDevtools store={store} name="Counter Store" initiallyOpen />)

    expect(screen.getByTestId('tanstack-store-devtools-history-count').textContent).toContain(
      '1 snapshot'
    )
    expect(screen.getByTestId('tanstack-store-devtools-current-state').textContent).toContain(
      '"count": 0'
    )
    expect(screen.getByTestId('tanstack-store-devtools-current-state').textContent).toContain(
      '"label": "initial"'
    )
  })

  it('tracks updates and keeps only the configured history size', () => {
    const store = createCounterStore(0, 'initial')

    render(
      <TanStackStoreDevtools store={store} name="Counter Store" initiallyOpen maxHistory={2} />
    )

    act(() => {
      store.setState((state) => ({ ...state, count: 1 }))
      store.setState((state) => ({ ...state, count: 2 }))
      store.setState((state) => ({ ...state, count: 3 }))
    })

    const historyEntries = screen.getAllByTestId('tanstack-store-devtools-history-entry')
    expect(historyEntries).toHaveLength(2)
    expect(historyEntries[0]?.textContent).toContain('"count": 3')
    expect(historyEntries[1]?.textContent).toContain('"count": 2')
    expect(screen.getByTestId('tanstack-store-devtools-history-count').textContent).toContain(
      '2 snapshots'
    )
    expect(screen.getByTestId('tanstack-store-devtools-current-state').textContent).toContain(
      '"count": 3'
    )
  })

  it('stores immutable snapshots even when nested references are reused', () => {
    interface NestedState {
      count: number
      nested: { value: number }
    }

    const sharedNested = { value: 0 }
    const store = new Store<NestedState>({
      count: 0,
      nested: sharedNested
    })

    render(<TanStackStoreDevtools store={store} name="Nested Store" initiallyOpen maxHistory={5} />)

    act(() => {
      sharedNested.value = 1
      store.setState((state) => ({ ...state, count: 1, nested: sharedNested }))
    })

    act(() => {
      sharedNested.value = 2
      store.setState((state) => ({ ...state, count: 2, nested: sharedNested }))
    })

    const historyEntries = screen.getAllByTestId('tanstack-store-devtools-history-entry')
    expect(historyEntries[0]?.textContent).toContain('"value": 2')
    expect(historyEntries[1]?.textContent).toContain('"value": 1')
  })

  it('toggles the panel visibility', () => {
    const store = createCounterStore(0, 'initial')

    render(<TanStackStoreDevtools store={store} name="Counter Store" />)

    expect(screen.queryByTestId('tanstack-store-devtools-panel')).toBeNull()
    fireEvent.click(screen.getByTestId('tanstack-store-devtools-toggle'))
    expect(screen.queryByTestId('tanstack-store-devtools-panel')).not.toBeNull()
    fireEvent.click(screen.getByTestId('tanstack-store-devtools-toggle'))
    expect(screen.queryByTestId('tanstack-store-devtools-panel')).toBeNull()
  })

  it('does not capture history updates while the panel is hidden', () => {
    const store = createCounterStore(0, 'initial')

    render(<TanStackStoreDevtools store={store} name="Counter Store" maxHistory={10} />)

    act(() => {
      store.setState((state) => ({ ...state, count: 1 }))
      store.setState((state) => ({ ...state, count: 2 }))
      store.setState((state) => ({ ...state, count: 3 }))
    })

    fireEvent.click(screen.getByTestId('tanstack-store-devtools-toggle'))

    const historyEntries = screen.getAllByTestId('tanstack-store-devtools-history-entry')
    expect(historyEntries).toHaveLength(1)
    expect(historyEntries[0]?.textContent).toContain('"count": 3')
    expect(screen.getByTestId('tanstack-store-devtools-history-count').textContent).toContain(
      '1 snapshot'
    )
  })

  it('uses explicit button sizing that is resilient to global button styles', () => {
    const store = createCounterStore(0, 'initial')

    render(<TanStackStoreDevtools store={store} name="Counter Store" />)

    const toggleButton = screen.getByTestId('tanstack-store-devtools-toggle')
    expect(toggleButton.style.width).toBe('auto')
    expect(toggleButton.style.minHeight).toBe('unset')

    fireEvent.click(toggleButton)

    const clearHistoryButton = screen.getByRole('button', { name: 'Clear history' })
    expect(clearHistoryButton.style.width).toBe('auto')
    expect(clearHistoryButton.style.minHeight).toBe('unset')
  })

  it('clears history and keeps only the latest snapshot', () => {
    const store = createCounterStore(0, 'initial')

    render(
      <TanStackStoreDevtools store={store} name="Counter Store" initiallyOpen maxHistory={10} />
    )

    act(() => {
      store.setState((state) => ({ ...state, count: 5 }))
      store.setState((state) => ({ ...state, count: 8 }))
    })

    fireEvent.click(screen.getByRole('button', { name: 'Clear history' }))

    const historyEntries = screen.getAllByTestId('tanstack-store-devtools-history-entry')
    expect(historyEntries).toHaveLength(1)
    expect(historyEntries[0]?.textContent).toContain('"count": 8')
    expect(screen.getByTestId('tanstack-store-devtools-history-count').textContent).toContain(
      '1 snapshot'
    )
  })

  it('resets history when a different store instance is mounted', () => {
    const firstStore = createCounterStore(0, 'first')
    const secondStore = createCounterStore(99, 'second')
    const { rerender } = render(
      <TanStackStoreDevtools store={firstStore} name="Counter Store" initiallyOpen />
    )

    act(() => {
      firstStore.setState((state) => ({ ...state, count: 42 }))
    })

    rerender(<TanStackStoreDevtools store={secondStore} name="Counter Store" initiallyOpen />)

    expect(screen.getByTestId('tanstack-store-devtools-current-state').textContent).toContain(
      '"count": 99'
    )
    expect(screen.getByTestId('tanstack-store-devtools-current-state').textContent).toContain(
      '"label": "second"'
    )
    expect(screen.getByTestId('tanstack-store-devtools-history-count').textContent).toContain(
      '1 snapshot'
    )
  })

  it('clamps maxHistory values below 1 to a single snapshot', () => {
    const store = createCounterStore(0, 'initial')

    render(<TanStackStoreDevtools store={store} name="Counter Store" initiallyOpen maxHistory={0} />)

    act(() => {
      store.setState((state) => ({ ...state, count: 1 }))
      store.setState((state) => ({ ...state, count: 2 }))
    })

    const historyEntries = screen.getAllByTestId('tanstack-store-devtools-history-entry')
    expect(historyEntries).toHaveLength(1)
    expect(historyEntries[0]?.textContent).toContain('"count": 2')
    expect(screen.getByTestId('tanstack-store-devtools-history-count').textContent).toContain(
      '1 snapshot'
    )
  })

  it('uses default history size when maxHistory is not finite', () => {
    const store = createCounterStore(0, 'initial')

    render(
      <TanStackStoreDevtools
        store={store}
        name="Counter Store"
        initiallyOpen
        maxHistory={Number.POSITIVE_INFINITY}
      />
    )

    act(() => {
      for (let count = 1; count <= 40; count += 1) {
        store.setState((state) => ({ ...state, count }))
      }
    })

    const historyEntries = screen.getAllByTestId('tanstack-store-devtools-history-entry')
    expect(historyEntries).toHaveLength(25)
    expect(historyEntries[0]?.textContent).toContain('"count": 40')
    expect(historyEntries[24]?.textContent).toContain('"count": 16')
  })
})

describe('formatStoreSnapshot', () => {
  it('returns a fallback for unserializable snapshots', () => {
    const cyclic: { label: string; self?: unknown } = { label: 'cycle' }
    cyclic.self = cyclic

    expect(formatStoreSnapshot(cyclic)).toBe('[unserializable snapshot]')
  })
})
