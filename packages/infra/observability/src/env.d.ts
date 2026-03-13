export interface ObservabilityEnv {
    OTEL_LOG_LEVEL: string | undefined;
    OTEL_EXPORTER_OTLP_ENDPOINT: string;
    OTEL_LOGS_EXPORTER: 'otlp' | 'none';
    NODE_ENV: string;
}
export interface LangfuseEnv {
    LANGFUSE_ENABLED: boolean;
    LANGFUSE_PUBLIC_KEY: string;
    LANGFUSE_SECRET_KEY: string;
    LANGFUSE_BASE_URL: string;
}
export interface ClientObservabilityEnv {
    OTEL_EXPORTER_OTLP_ENDPOINT: string;
    NODE_ENV: string;
}
export declare const getObservabilityEnv: () => ObservabilityEnv;
export declare const getLangfuseEnv: () => LangfuseEnv;
export declare const getClientObservabilityEnv: () => ClientObservabilityEnv;
//# sourceMappingURL=env.d.ts.map