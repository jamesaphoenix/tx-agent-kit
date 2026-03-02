import { expect } from 'vitest'
import type { LogCapture, LogQuery } from './log-capture.js'

const describeFilter = (filter: LogQuery): string => {
  const parts: string[] = []
  if (filter.level !== undefined) {
    parts.push(`level=${filter.level}`)
  }
  if (filter.message !== undefined) {
    parts.push(`message=${String(filter.message)}`)
  }
  if (filter.service !== undefined) {
    parts.push(`service=${String(filter.service)}`)
  }
  if (filter.context !== undefined) {
    parts.push(`context=${JSON.stringify(filter.context)}`)
  }
  if (filter.error !== undefined) {
    parts.push(`error=${String(filter.error)}`)
  }
  return parts.join(', ')
}

export const expectLogEntry = (
  capture: LogCapture,
  filter: LogQuery,
  message?: string
): void => {
  const matches = capture.query(filter)
  expect(
    matches.length,
    message ?? `Expected at least 1 log entry matching {${describeFilter(filter)}}, found 0`
  ).toBeGreaterThanOrEqual(1)
}

export const expectNoLogEntry = (
  capture: LogCapture,
  filter: LogQuery,
  message?: string
): void => {
  const matches = capture.query(filter)
  expect(
    matches.length,
    message ?? `Expected 0 log entries matching {${describeFilter(filter)}}, found ${matches.length}`
  ).toBe(0)
}

export const expectLogCount = (
  capture: LogCapture,
  filter: LogQuery,
  count: number,
  message?: string
): void => {
  const matches = capture.query(filter)
  expect(
    matches.length,
    message ?? `Expected ${count} log entries matching {${describeFilter(filter)}}, found ${matches.length}`
  ).toBe(count)
}
