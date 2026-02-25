'use client'

import type { Store } from '@tanstack/react-store'
import { useStore } from '@tanstack/react-store'
import { useEffect, useRef, useState, type CSSProperties } from 'react'

interface StoreHistoryEntry<TState> {
  id: number
  capturedAt: string
  snapshot: TState
}

export interface TanStackStoreDevtoolsProps<TState> {
  store: Store<TState>
  name: string
  maxHistory?: number
  initiallyOpen?: boolean
}

const defaultMaxHistory = 25

const floatingContainerStyle: CSSProperties = {
  position: 'fixed',
  right: '1rem',
  bottom: '1rem',
  zIndex: 1200,
  display: 'flex',
  flexDirection: 'column',
  gap: '0.5rem',
  alignItems: 'flex-end',
  fontFamily: 'Menlo, Monaco, Consolas, Liberation Mono, monospace'
}

const panelStyle: CSSProperties = {
  width: 'min(42rem, calc(100vw - 2rem))',
  maxHeight: '70vh',
  overflow: 'auto',
  border: '1px solid #d1d5db',
  borderRadius: '0.75rem',
  background: '#ffffff',
  boxShadow: '0 10px 30px rgba(15, 23, 42, 0.22)',
  padding: '0.75rem'
}

const sectionTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: '0.8rem',
  fontWeight: 700,
  color: '#374151',
  letterSpacing: '0.01em'
}

const devtoolsButtonBaseStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 'auto',
  minHeight: 'unset',
  flex: '0 0 auto',
  margin: 0,
  fontFamily: 'inherit',
  lineHeight: 1.2,
  whiteSpace: 'nowrap',
  cursor: 'pointer'
}

const toggleButtonStyle: CSSProperties = {
  ...devtoolsButtonBaseStyle,
  borderRadius: '999px',
  border: '1px solid #0f172a',
  background: '#0f172a',
  color: '#f8fafc',
  fontSize: '0.75rem',
  fontWeight: 700,
  padding: '0.4rem 0.7rem'
}

const secondaryButtonStyle: CSSProperties = {
  ...devtoolsButtonBaseStyle,
  border: '1px solid #d1d5db',
  background: '#ffffff',
  color: '#0f172a',
  borderRadius: '0.4rem',
  fontSize: '0.7rem',
  fontWeight: 600,
  padding: '0.25rem 0.45rem'
}

const preStyle: CSSProperties = {
  margin: 0,
  fontSize: '0.75rem',
  lineHeight: 1.35,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  borderRadius: '0.5rem',
  padding: '0.5rem',
  backgroundColor: '#f8fafc',
  border: '1px solid #e2e8f0'
}

const createHistoryEntry = <TState,>(id: number, snapshot: TState): StoreHistoryEntry<TState> => {
  return {
    id,
    capturedAt: new Date().toISOString(),
    snapshot: cloneSnapshot(snapshot)
  }
}

const resolveHistorySize = (requestedSize: number): number => {
  if (!Number.isFinite(requestedSize)) {
    return defaultMaxHistory
  }

  return Math.max(1, Math.floor(requestedSize))
}

const cloneSnapshot = <TState,>(snapshot: TState): TState => {
  if (typeof globalThis.structuredClone === 'function') {
    try {
      return globalThis.structuredClone(snapshot)
    } catch {
      // Fall through to JSON cloning below.
    }
  }

  try {
    return JSON.parse(JSON.stringify(snapshot)) as TState
  } catch {
    return snapshot
  }
}

export const formatStoreSnapshot = (snapshot: unknown): string => {
  try {
    const serialized = JSON.stringify(snapshot, null, 2)
    return serialized ?? 'null'
  } catch {
    return '[unserializable snapshot]'
  }
}

export function TanStackStoreDevtools<TState>({
  store,
  name,
  maxHistory = defaultMaxHistory,
  initiallyOpen = false
}: TanStackStoreDevtoolsProps<TState>) {
  const historySize = resolveHistorySize(maxHistory)
  const currentState = useStore(store, (snapshot) => snapshot)
  const [isOpen, setIsOpen] = useState(initiallyOpen)
  const nextHistoryIdRef = useRef(1)
  const wasOpenRef = useRef(initiallyOpen)
  const [history, setHistory] = useState<Array<StoreHistoryEntry<TState>>>(() => [
    createHistoryEntry(0, store.state)
  ])

  useEffect(() => {
    nextHistoryIdRef.current = 1
    setHistory([createHistoryEntry(0, store.state)])
  }, [store])

  useEffect(() => {
    if (!isOpen) {
      wasOpenRef.current = false
      return
    }

    if (!wasOpenRef.current) {
      nextHistoryIdRef.current = 1
      setHistory([createHistoryEntry(0, store.state)])
    }
    wasOpenRef.current = true

    const subscription = store.subscribe((snapshot) => {
      setHistory((previousHistory) => {
        const nextEntry = createHistoryEntry(nextHistoryIdRef.current, snapshot)
        nextHistoryIdRef.current += 1
        return [nextEntry, ...previousHistory].slice(0, historySize)
      })
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [historySize, isOpen, store])

  useEffect(() => {
    setHistory((previousHistory) => previousHistory.slice(0, historySize))
  }, [historySize])

  return (
    <div style={floatingContainerStyle}>
      <button
        type="button"
        data-testid="tanstack-store-devtools-toggle"
        onClick={() => setIsOpen((value) => !value)}
        style={toggleButtonStyle}
      >
        {isOpen ? `Hide ${name}` : `Show ${name}`}
      </button>

      {isOpen ? (
        <section data-testid="tanstack-store-devtools-panel" style={panelStyle}>
          <header
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '0.5rem',
              marginBottom: '0.5rem'
            }}
          >
            <strong style={{ fontSize: '0.9rem' }}>{name}</strong>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
                gap: '0.5rem',
                flexWrap: 'wrap'
              }}
            >
              <span
                data-testid="tanstack-store-devtools-history-count"
                style={{ fontSize: '0.75rem', color: '#64748b', whiteSpace: 'nowrap' }}
              >
                {history.length} snapshot{history.length === 1 ? '' : 's'}
              </span>
              <button
                type="button"
                onClick={() => {
                  nextHistoryIdRef.current = 1
                  setHistory([createHistoryEntry(0, store.state)])
                }}
                style={secondaryButtonStyle}
              >
                Clear history
              </button>
            </div>
          </header>

          <div style={{ display: 'grid', gap: '0.6rem' }}>
            <div>
              <h3 style={sectionTitleStyle}>Current snapshot</h3>
              <pre data-testid="tanstack-store-devtools-current-state" style={preStyle}>
                {formatStoreSnapshot(currentState)}
              </pre>
            </div>

            <div>
              <h3 style={sectionTitleStyle}>History (newest first)</h3>
              <ol
                data-testid="tanstack-store-devtools-history"
                style={{ margin: 0, padding: 0, display: 'grid', gap: '0.5rem', listStyle: 'none' }}
              >
                {history.map((entry) => (
                  <li key={entry.id} data-testid="tanstack-store-devtools-history-entry">
                    <div style={{ fontSize: '0.7rem', color: '#64748b', marginBottom: '0.2rem' }}>
                      #{entry.id} at {entry.capturedAt}
                    </div>
                    <pre style={preStyle}>{formatStoreSnapshot(entry.snapshot)}</pre>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  )
}
