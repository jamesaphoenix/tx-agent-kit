export const httpClientRequestCountMetricName = 'tx_agent_kit_client_http_request_total';
export const httpClientRequestDurationMetricName = 'tx_agent_kit_client_http_request_duration';
export const nodeServiceStartupMetricName = 'tx_agent_kit_node_service_startup_total';
const httpClientMetricsRegistry = new Map();
const nodeServiceMetricsRegistry = new Map();
export const getOrCreateHttpClientMetrics = (meter) => {
    const existing = httpClientMetricsRegistry.get(meter);
    if (existing) {
        return existing;
    }
    const created = {
        requestCounter: meter.createCounter(httpClientRequestCountMetricName, {
            unit: '{request}',
            description: 'Total HTTP requests emitted by client applications.'
        }),
        requestDurationHistogram: meter.createHistogram(httpClientRequestDurationMetricName, {
            unit: 'ms',
            description: 'HTTP request duration in milliseconds emitted by client applications.'
        })
    };
    httpClientMetricsRegistry.set(meter, created);
    return created;
};
export const getOrCreateNodeServiceMetrics = (meter) => {
    const existing = nodeServiceMetricsRegistry.get(meter);
    if (existing) {
        return existing;
    }
    const created = {
        startupCounter: meter.createCounter(nodeServiceStartupMetricName, {
            unit: '{startup}',
            description: 'Service startup events emitted by Node.js runtimes.'
        })
    };
    nodeServiceMetricsRegistry.set(meter, created);
    return created;
};
export const _resetMetricsRegistryForTest = () => {
    httpClientMetricsRegistry.clear();
    nodeServiceMetricsRegistry.clear();
};
//# sourceMappingURL=metrics-registry.js.map