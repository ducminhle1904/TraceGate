# @tracegate/core

Core contracts, schemas, and policy primitives for TraceGate.

TraceGate core includes framework-neutral contracts, runtime wrapping, configurable policy defaults, redaction, replay fixture contracts, trace sinks, and matrix case schemas.

Use `createHarness()` and `wrapTool()` to validate tool input, evaluate policy, redact traces, record evidence, and emit ordered trace events.
