# Observability Integrations

TraceGate complements existing observability tools by producing structured contract,
policy, evidence, and replay data that can be exported elsewhere.

## Current Export Targets

- JSONL remains the local-first trace format in `@tracegate/core`.
- `@tracegate/adapters/opentelemetry` maps TraceGate events to spans with stable
  `tracegate.*` attributes.
- `@tracegate/adapters/braintrust` maps matrix/replay results to JSON-serializable eval
  rows.
- `@tracegate/adapters/langfuse` maps TraceGate events to Langfuse-compatible trace/event
  payloads.

## OpenTelemetry

```ts
import { createHarness } from "@tracegate/core";
import { createOpenTelemetryTraceSink } from "@tracegate/adapters/opentelemetry";

const harness = createHarness({
  traceSink: createOpenTelemetryTraceSink({
    tracer,
    flush: () => provider.forceFlush(),
  }),
});
```

The sink creates spans for run, tool, and evidence events. It does not replace JSONL traces
or replay fixtures. Pass `flush` when your OpenTelemetry setup uses a batch span processor
and the process may exit immediately after `harness.finishRun()`.

## Braintrust

```ts
import { toBraintrustEvalRows } from "@tracegate/adapters/braintrust";

const rows = toBraintrustEvalRows(matrixReport);
```

Rows are plain JSON so they can be written as CI artifacts or passed into a project-owned
Braintrust logging flow.

## Langfuse

```ts
import { toLangfuseTraceEvents } from "@tracegate/adapters/langfuse";

const events = toLangfuseTraceEvents(traceGateEvents);
```

The mapper is credential-free. `createLangfuseTraceSink()` is no-op by default and writes
only when a configured writer is provided.

## Principles

- Do not make observability the product center.
- Keep TraceGate useful without a hosted service.
- Preserve enough context for replay and CI.
- Avoid storing secrets in exported traces.
- Treat LangSmith, Langfuse, Braintrust, Phoenix, and OTel backends as downstream views,
  not as TraceGate's source of truth.
