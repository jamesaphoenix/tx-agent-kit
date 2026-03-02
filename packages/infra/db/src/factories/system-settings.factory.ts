import type { JsonObject } from '../schema.js'

export interface CreateSystemSettingFactoryOptions {
  key?: string
  value?: JsonObject
  description?: string | null
}

export const createSystemSettingFactory = (
  options: CreateSystemSettingFactoryOptions = {}
): {
  key: string
  value: JsonObject
  description: string | null
} => ({
  key: options.key ?? `test-setting-${crypto.randomUUID().slice(0, 8)}`,
  value: options.value ?? { enabled: true },
  description: options.description ?? null
})
