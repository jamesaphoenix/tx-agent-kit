const defaultOtelEndpoint = 'http://localhost:4320';
const defaultClientOtelEndpoint = 'http://localhost:4320';
const defaultNodeEnv = 'development';
export const getObservabilityEnv = () => {
    const logLevel = process.env.OTEL_LOG_LEVEL?.toLowerCase();
    const logsExporter = process.env.OTEL_LOGS_EXPORTER?.toLowerCase();
    return {
        OTEL_LOG_LEVEL: logLevel,
        OTEL_EXPORTER_OTLP_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? defaultOtelEndpoint,
        OTEL_LOGS_EXPORTER: logsExporter === 'none' ? 'none' : 'otlp',
        NODE_ENV: process.env.NODE_ENV ?? defaultNodeEnv
    };
};
export const getLangfuseEnv = () => {
    return {
        LANGFUSE_ENABLED: process.env.LANGFUSE_ENABLED === 'true',
        LANGFUSE_PUBLIC_KEY: process.env.LANGFUSE_PUBLIC_KEY ?? '',
        LANGFUSE_SECRET_KEY: process.env.LANGFUSE_SECRET_KEY ?? '',
        LANGFUSE_BASE_URL: process.env.LANGFUSE_BASE_URL ?? 'http://localhost:3200'
    };
};
export const getClientObservabilityEnv = () => {
    return {
        OTEL_EXPORTER_OTLP_ENDPOINT: process.env.NEXT_PUBLIC_OTEL_EXPORTER_OTLP_ENDPOINT ??
            process.env.EXPO_PUBLIC_OTEL_EXPORTER_OTLP_ENDPOINT ??
            process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
            defaultClientOtelEndpoint,
        NODE_ENV: process.env.NEXT_PUBLIC_NODE_ENV ??
            process.env.EXPO_PUBLIC_NODE_ENV ??
            process.env.NODE_ENV ??
            defaultNodeEnv
    };
};
//# sourceMappingURL=env.js.map