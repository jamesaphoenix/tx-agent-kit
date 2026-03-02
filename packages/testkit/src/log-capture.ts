export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface ParsedLogEntry {
  timestamp: string
  level: LogLevel
  service: string
  message: string
  context?: Record<string, unknown>
  error?: {
    name: string
    message: string
    stack?: string
  }
}

export interface LogQuery {
  level?: LogLevel
  message?: string | RegExp
  service?: string | RegExp
  context?: Record<string, unknown>
  error?: boolean
}

export interface LogCapture {
  readonly entries: ReadonlyArray<ParsedLogEntry>
  query: (filter: LogQuery) => ReadonlyArray<ParsedLogEntry>
  has: (filter: LogQuery) => boolean
  count: (filter: LogQuery) => number
  first: (filter: LogQuery) => ParsedLogEntry | undefined
  last: (filter: LogQuery) => ParsedLogEntry | undefined
}

const validLogLevels = new Set<string>(['debug', 'info', 'warn', 'error'])

const isLogLevel = (value: unknown): value is LogLevel =>
  typeof value === 'string' && validLogLevels.has(value)

const tryParseLogEntry = (line: string): ParsedLogEntry | null => {
  const trimmed = line.trim()
  if (!trimmed.startsWith('{')) {
    return null
  }

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>

    if (
      typeof parsed.timestamp !== 'string' ||
      !isLogLevel(parsed.level) ||
      typeof parsed.service !== 'string' ||
      typeof parsed.message !== 'string'
    ) {
      return null
    }

    return {
      timestamp: parsed.timestamp,
      level: parsed.level,
      service: parsed.service,
      message: parsed.message,
      context: typeof parsed.context === 'object' && parsed.context !== null
        ? parsed.context as Record<string, unknown>
        : undefined,
      error: typeof parsed.error === 'object' && parsed.error !== null
        ? parsed.error as ParsedLogEntry['error']
        : undefined
    }
  } catch {
    return null
  }
}

const matchesString = (value: string, filter: string | RegExp): boolean => {
  if (typeof filter === 'string') {
    return value.includes(filter)
  }
  return filter.test(value)
}

const matchesContext = (
  entryContext: Record<string, unknown> | undefined,
  filterContext: Record<string, unknown>
): boolean => {
  if (!entryContext) {
    return false
  }

  for (const [key, value] of Object.entries(filterContext)) {
    if (entryContext[key] !== value) {
      return false
    }
  }

  return true
}

const matchesFilter = (entry: ParsedLogEntry, filter: LogQuery): boolean => {
  if (filter.level !== undefined && entry.level !== filter.level) {
    return false
  }

  if (filter.message !== undefined && !matchesString(entry.message, filter.message)) {
    return false
  }

  if (filter.service !== undefined && !matchesString(entry.service, filter.service)) {
    return false
  }

  if (filter.context !== undefined && !matchesContext(entry.context, filter.context)) {
    return false
  }

  if (filter.error !== undefined) {
    const hasError = entry.error !== undefined
    if (filter.error !== hasError) {
      return false
    }
  }

  return true
}

export const parseLogOutput = (output: ReadonlyArray<string>): LogCapture => {
  const raw = output.join('')
  const lines = raw.split('\n')
  const entries: ParsedLogEntry[] = []

  for (const line of lines) {
    const entry = tryParseLogEntry(line)
    if (entry) {
      entries.push(entry)
    }
  }

  const query = (filter: LogQuery): ReadonlyArray<ParsedLogEntry> =>
    entries.filter((entry) => matchesFilter(entry, filter))

  return {
    entries,
    query,
    has: (filter) => entries.some((entry) => matchesFilter(entry, filter)),
    count: (filter) => query(filter).length,
    first: (filter) => entries.find((entry) => matchesFilter(entry, filter)),
    last: (filter) => {
      const matches = query(filter)
      return matches[matches.length - 1]
    }
  }
}
