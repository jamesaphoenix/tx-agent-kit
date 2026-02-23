export const clientRequestTotalMetricQuery =
  'sum({__name__="tx_agent_kit_client_http_request_total"})'
export const clientRequestTotalSeriesQuery =
  '{__name__="tx_agent_kit_client_http_request_total"}'
export const nodeServiceStartupSeriesQuery =
  '{__name__="tx_agent_kit_node_service_startup_total"}'

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

const fetchJson = async <T>(url: string): Promise<T> => {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}): ${url}`)
  }
  return response.json() as Promise<T>
}

export const queryJaegerServices = async (
  jaegerApiUrl: string
): Promise<string[]> => {
  const payload = await fetchJson<{ data?: string[] }>(
    `${jaegerApiUrl}/api/services`
  )
  return payload.data ?? []
}

export const queryJaegerTraceCount = async (
  jaegerApiUrl: string,
  serviceName: string
): Promise<number> => {
  const queryUrl = new URL(`${jaegerApiUrl}/api/traces`)
  queryUrl.searchParams.set('service', serviceName)
  queryUrl.searchParams.set('limit', '1000')
  queryUrl.searchParams.set('lookback', '1h')

  const payload = await fetchJson<{ data?: unknown[] }>(queryUrl.toString())
  return Array.isArray(payload.data) ? payload.data.length : 0
}

export const queryPrometheusValue = async (
  prometheusApiUrl: string,
  query: string
): Promise<number> => {
  const queryUrl = new URL(`${prometheusApiUrl}/api/v1/query`)
  queryUrl.searchParams.set('query', query)

  const payload = await fetchJson<{
    data?: {
      result?: Array<{
        value?: [number, string]
      }>
    }
  }>(queryUrl.toString())

  const rawValue = payload.data?.result?.[0]?.value?.[1] ?? '0'
  const parsed = Number.parseFloat(rawValue)
  return Number.isFinite(parsed) ? parsed : 0
}

export interface PrometheusSeriesResult {
  readonly metric?: Record<string, string>
  readonly value?: [number, string]
}

export const queryPrometheusSeries = async (
  prometheusApiUrl: string,
  query: string
): Promise<ReadonlyArray<PrometheusSeriesResult>> => {
  const queryUrl = new URL(`${prometheusApiUrl}/api/v1/query`)
  queryUrl.searchParams.set('query', query)

  const payload = await fetchJson<{
    data?: {
      result?: PrometheusSeriesResult[]
    }
  }>(queryUrl.toString())

  return payload.data?.result ?? []
}

export const waitForCondition = async (
  predicate: () => Promise<boolean>,
  description: string,
  attempts: number,
  intervalMs: number
): Promise<void> => {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (await predicate()) {
      return
    }

    await sleep(intervalMs)
  }

  throw new Error(`Timed out waiting for condition: ${description}`)
}
