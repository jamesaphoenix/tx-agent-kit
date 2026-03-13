import type { Counter, Histogram, Meter } from '@opentelemetry/api';
export declare const httpClientRequestCountMetricName = "tx_agent_kit_client_http_request_total";
export declare const httpClientRequestDurationMetricName = "tx_agent_kit_client_http_request_duration";
export declare const nodeServiceStartupMetricName = "tx_agent_kit_node_service_startup_total";
export interface HttpClientMetrics {
    readonly requestCounter: Counter;
    readonly requestDurationHistogram: Histogram;
}
export interface NodeServiceMetrics {
    readonly startupCounter: Counter;
}
export interface HttpClientMeter {
    readonly createCounter: Meter['createCounter'];
    readonly createHistogram: Meter['createHistogram'];
}
export interface NodeServiceMeter {
    readonly createCounter: Meter['createCounter'];
}
export declare const getOrCreateHttpClientMetrics: (meter: HttpClientMeter) => HttpClientMetrics;
export declare const getOrCreateNodeServiceMetrics: (meter: NodeServiceMeter) => NodeServiceMetrics;
export declare const _resetMetricsRegistryForTest: () => void;
//# sourceMappingURL=metrics-registry.d.ts.map