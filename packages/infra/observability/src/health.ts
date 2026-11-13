/**
 * True for the liveness endpoint (`GET /health`), with or without a query
 * string. Lookalike paths such as `/healthz` or `/v1/health` do not match.
 */
export const isHealthCheckRequestUrl = (url: string): boolean => {
  const queryStart = url.indexOf('?')
  const path = queryStart === -1 ? url : url.slice(0, queryStart)
  return path === '/health'
}
