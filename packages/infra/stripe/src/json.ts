/**
 * Minimal JSON helpers used by the Stripe webhook payload parser. Kept local
 * to the package so the public surface of `@tx-agent-kit/stripe` stays free
 * of utility types consumers don't need.
 */

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[]
export interface JsonObject {
  [key: string]: JsonValue
}

export const toJsonValue = (value: unknown): JsonValue => {
  if (value === null) {
    return null
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }

  if (Array.isArray(value)) {
    return value.map((entry) => toJsonValue(entry))
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value)
    const mapped: JsonObject = {}
    for (const [key, child] of entries) {
      mapped[key] = toJsonValue(child)
    }
    return mapped
  }

  return null
}

export const toJsonObject = (value: unknown): JsonObject => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {}
  }

  const result: JsonObject = {}
  for (const [key, child] of Object.entries(value)) {
    result[key] = toJsonValue(child)
  }
  return result
}

export const readStringMember = (value: unknown, key: string): string | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }

  const maybe = (value as Record<string, unknown>)[key]
  return typeof maybe === 'string' ? maybe : null
}
