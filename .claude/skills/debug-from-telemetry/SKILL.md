# debug-from-telemetry

Use this skill to debug failures by correlating traces, logs, and metrics.

## Steps
1. Query traces first to find failing spans.
2. Correlate span IDs with application logs.
3. Confirm fix by re-running the same flow and checking span latency/error count.
