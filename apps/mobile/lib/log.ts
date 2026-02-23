const isDev = typeof __DEV__ !== 'undefined' && __DEV__

export const log = {
  info: (...args: unknown[]): void => { if (isDev) console.log('[INFO]', ...args) },
  warn: (...args: unknown[]): void => { if (isDev) console.warn('[WARN]', ...args) },
  error: (...args: unknown[]): void => { console.error('[ERROR]', ...args) },
  debug: (...args: unknown[]): void => { if (isDev) console.debug('[DEBUG]', ...args) }
}
