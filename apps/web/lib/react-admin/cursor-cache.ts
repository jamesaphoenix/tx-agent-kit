'use client'

export class CursorCache {
  private readonly cache = new Map<string, Map<number, string | undefined>>()

  getCursor(key: string, page: number): string | undefined {
    if (page <= 1) {
      return undefined
    }

    return this.cache.get(key)?.get(page)
  }

  setCursor(key: string, page: number, cursor: string | null): void {
    const byPage = this.cache.get(key) ?? new Map<number, string | undefined>()
    byPage.set(page, cursor ?? undefined)
    this.cache.set(key, byPage)
  }

  ensureFirstPage(key: string): void {
    const byPage = this.cache.get(key) ?? new Map<number, string | undefined>()
    byPage.set(1, undefined)
    this.cache.set(key, byPage)
  }

  clearKey(key: string): void {
    this.cache.delete(key)
  }

  clearAll(): void {
    this.cache.clear()
  }
}

export const cursorCache = new CursorCache()
