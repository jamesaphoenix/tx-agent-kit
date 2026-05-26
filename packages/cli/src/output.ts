export class CliUserError extends Error {
  readonly code: string
  readonly hint?: string

  constructor(input: { readonly code: string; readonly message: string; readonly hint?: string }) {
    super(input.message)
    this.name = 'CliUserError'
    this.code = input.code
    this.hint = input.hint
  }
}

export const parseFieldMask = (value: string | undefined): readonly string[] | null => {
  if (value === undefined || value.trim().length === 0) {
    return null
  }
  return value
    .split(',')
    .map((field) => field.trim())
    .filter(Boolean)
}

const readNestedField = (value: unknown, path: readonly string[]): unknown => {
  let current = value
  for (const segment of path) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) {
      return undefined
    }
    current = (current as Readonly<Record<string, unknown>>)[segment]
  }
  return current
}

const writeNestedField = (
  target: Record<string, unknown>,
  path: readonly string[],
  value: unknown
): void => {
  let current = target
  for (const [index, segment] of path.entries()) {
    if (index === path.length - 1) {
      current[segment] = value
      return
    }

    const next = current[segment]
    if (typeof next !== 'object' || next === null || Array.isArray(next)) {
      current[segment] = {}
    }
    current = current[segment] as Record<string, unknown>
  }
}

export const selectFields = (
  value: unknown,
  fields: readonly string[] | null
): unknown => {
  if (fields === null) {
    return value
  }

  const output: Record<string, unknown> = {}
  for (const field of fields) {
    const path = field.split('.').filter(Boolean)
    const selected = readNestedField(value, path)
    if (selected !== undefined) {
      writeNestedField(output, path, selected)
    }
  }
  return output
}

export const writeJsonLine = (stdout: { readonly write: (chunk: string) => void }, value: unknown): void => {
  stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}
