import { describe, expect, it } from 'vitest'
import { parseLogOutput } from './log-capture.js'
import { expectLogEntry, expectNoLogEntry, expectLogCount } from './log-assertions.js'

const entry = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({
    timestamp: '2026-01-15T10:30:00.000Z',
    level: 'info',
    service: 'api',
    message: 'Request handled',
    ...overrides
  })

describe('log-capture', () => {
  describe('parseLogOutput', () => {
    it('parses valid JSON log lines', () => {
      const output = [entry(), '\n', entry({ level: 'error', message: 'Oops' }), '\n']
      const capture = parseLogOutput(output)

      expect(capture.entries).toHaveLength(2)
      expect(capture.entries[0]?.level).toBe('info')
      expect(capture.entries[1]?.level).toBe('error')
    })

    it('skips non-JSON lines', () => {
      const output = [
        'Starting server...\n',
        entry(),
        '\n',
        'Listening on port 4100\n'
      ]
      const capture = parseLogOutput(output)

      expect(capture.entries).toHaveLength(1)
    })

    it('handles chunks that split across array elements', () => {
      const full = entry({ message: 'split line' })
      const half1 = full.slice(0, 20)
      const half2 = full.slice(20)
      const output = [half1, half2, '\n']
      const capture = parseLogOutput(output)

      expect(capture.entries).toHaveLength(1)
      expect(capture.entries[0]?.message).toBe('split line')
    })

    it('handles empty output', () => {
      const capture = parseLogOutput([])
      expect(capture.entries).toHaveLength(0)
    })

    it('skips JSON objects without required fields', () => {
      const output = [
        JSON.stringify({ random: 'object' }),
        '\n',
        entry(),
        '\n'
      ]
      const capture = parseLogOutput(output)

      expect(capture.entries).toHaveLength(1)
    })

    it('parses entries with context', () => {
      const output = [
        entry({ context: { userId: 'abc', action: 'login' } }),
        '\n'
      ]
      const capture = parseLogOutput(output)

      expect(capture.entries[0]?.context).toEqual({ userId: 'abc', action: 'login' })
    })

    it('parses entries with error', () => {
      const output = [
        entry({
          level: 'error',
          error: { name: 'TypeError', message: 'bad input', stack: 'at line 1' }
        }),
        '\n'
      ]
      const capture = parseLogOutput(output)

      expect(capture.entries[0]?.error).toEqual({
        name: 'TypeError',
        message: 'bad input',
        stack: 'at line 1'
      })
    })
  })

  describe('query methods', () => {
    const output = [
      entry({ level: 'info', message: 'Started', service: 'api' }),
      '\n',
      entry({ level: 'warn', message: 'Slow query', service: 'db' }),
      '\n',
      entry({ level: 'error', message: 'Connection failed', service: 'db', error: { name: 'Error', message: 'timeout' } }),
      '\n',
      entry({ level: 'info', message: 'Request completed', service: 'api', context: { status: 200 } }),
      '\n'
    ]

    it('query filters by level', () => {
      const capture = parseLogOutput(output)
      const results = capture.query({ level: 'info' })
      expect(results).toHaveLength(2)
    })

    it('query filters by message string', () => {
      const capture = parseLogOutput(output)
      const results = capture.query({ message: 'Slow' })
      expect(results).toHaveLength(1)
      expect(results[0]?.message).toBe('Slow query')
    })

    it('query filters by message regex', () => {
      const capture = parseLogOutput(output)
      const results = capture.query({ message: /^(Started|Request)/ })
      expect(results).toHaveLength(2)
    })

    it('query filters by service string', () => {
      const capture = parseLogOutput(output)
      const results = capture.query({ service: 'db' })
      expect(results).toHaveLength(2)
    })

    it('query filters by service regex', () => {
      const capture = parseLogOutput(output)
      const results = capture.query({ service: /^api$/ })
      expect(results).toHaveLength(2)
    })

    it('query filters by error presence', () => {
      const capture = parseLogOutput(output)
      expect(capture.query({ error: true })).toHaveLength(1)
      expect(capture.query({ error: false })).toHaveLength(3)
    })

    it('query filters by context', () => {
      const capture = parseLogOutput(output)
      const results = capture.query({ context: { status: 200 } })
      expect(results).toHaveLength(1)
    })

    it('has returns true when matches exist', () => {
      const capture = parseLogOutput(output)
      expect(capture.has({ level: 'warn' })).toBe(true)
    })

    it('has returns false when no matches', () => {
      const capture = parseLogOutput(output)
      expect(capture.has({ level: 'debug' })).toBe(false)
    })

    it('count returns correct number', () => {
      const capture = parseLogOutput(output)
      expect(capture.count({ service: 'db' })).toBe(2)
    })

    it('first returns first matching entry', () => {
      const capture = parseLogOutput(output)
      const result = capture.first({ service: 'api' })
      expect(result?.message).toBe('Started')
    })

    it('last returns last matching entry', () => {
      const capture = parseLogOutput(output)
      const result = capture.last({ service: 'api' })
      expect(result?.message).toBe('Request completed')
    })

    it('first returns undefined when no match', () => {
      const capture = parseLogOutput(output)
      expect(capture.first({ level: 'debug' })).toBeUndefined()
    })

    it('last returns undefined when no match', () => {
      const capture = parseLogOutput(output)
      expect(capture.last({ level: 'debug' })).toBeUndefined()
    })
  })
})

describe('log-assertions', () => {
  const output = [
    entry({ level: 'info', message: 'Started' }),
    '\n',
    entry({ level: 'error', message: 'Failed' }),
    '\n'
  ]

  it('expectLogEntry passes when match exists', () => {
    const capture = parseLogOutput(output)
    expect(() => expectLogEntry(capture, { level: 'info' })).not.toThrow()
  })

  it('expectLogEntry throws when no match', () => {
    const capture = parseLogOutput(output)
    expect(() => expectLogEntry(capture, { level: 'debug' })).toThrow()
  })

  it('expectNoLogEntry passes when no match', () => {
    const capture = parseLogOutput(output)
    expect(() => expectNoLogEntry(capture, { level: 'warn' })).not.toThrow()
  })

  it('expectNoLogEntry throws when match exists', () => {
    const capture = parseLogOutput(output)
    expect(() => expectNoLogEntry(capture, { level: 'info' })).toThrow()
  })

  it('expectLogCount passes on exact count', () => {
    const capture = parseLogOutput(output)
    expect(() => expectLogCount(capture, { level: 'info' }, 1)).not.toThrow()
  })

  it('expectLogCount throws on wrong count', () => {
    const capture = parseLogOutput(output)
    expect(() => expectLogCount(capture, { level: 'info' }, 2)).toThrow()
  })
})
