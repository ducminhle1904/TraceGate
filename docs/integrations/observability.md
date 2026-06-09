# Observability Integrations

TraceGate complements existing observability tools by producing structured contract,
policy, evidence, and replay data that can be exported elsewhere.

## Current Export Targets

- JSONL remains the local-first trace format in `@tracegate/core`.
- `createStructuredLoggerTraceSink()` forwards already-redacted runtime events to your logger.
- `@tracegate/adapters/opentelemetry` maps TraceGate events to spans with stable
  `tracegate.*` attributes.
- `@tracegate/adapters/braintrust` maps matrix/replay results to JSON-serializable eval
  rows.
- `@tracegate/adapters/langfuse` maps TraceGate events to Langfuse-compatible trace/event
  payloads.

Runtime gate does not write files by default. Use JSONL for local and CI probes. In staging and
production, prefer a structured logger, OpenTelemetry, Langfuse, or a project-owned event writer.

## Structured Logger

```ts
import { createRuntimeGate, createStructuredLoggerTraceSink } from "@tracegate/core";

const gate = createRuntimeGate({
  mode: "observe",
  traceSink: createStructuredLoggerTraceSink({
    log: (event) => logger.info({ tracegate: event }, "tracegate.tool"),
  }),
  onSummary: (summary) => logger.info({ tracegateSummary: summary }, "tracegate.summary"),
});
```

TraceGate redacts before sink writes. Secret detection should run on the emitted event or on replay
fixtures, not on unbounded application objects.

## Datadog-Style JSON Logs

```ts
const traceSink = createStructuredLoggerTraceSink({
  log: (event) =>
    logger.info({
      service: "agent-runtime",
      ddsource: "tracegate",
      tracegate_event_type: event.type,
      tracegate_run_id: event.runId,
      tracegate: event,
    }),
});
```

Use facets such as `tracegate_event_type`, `record.toolName`, `record.riskTier`, and
`record.policyVerdict.status` for dashboards and alerts.

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
import { createLangfuseTraceSink, toLangfuseTraceEvents } from "@tracegate/adapters/langfuse";

const events = toLangfuseTraceEvents(traceGateEvents);

const traceSink = createLangfuseTraceSink({
  writer: (event) => langfuseWriter.write(event),
});
```

The mapper is credential-free. `createLangfuseTraceSink()` is no-op by default and writes
only when a configured writer is provided.

## Custom Event Writer

```ts
const traceSink = {
  async write(event) {
    await eventBus.publish("tracegate.runtime_event", event);
  },
  async flush() {
    await eventBus.flush?.();
  },
};
```

Keep replay fixtures local-first even when production events are sent to a backend. Use
`tracegate runtime record` to turn a sanitized JSONL export into a fixture.

## Principles

- Do not make observability the product center.
- Keep TraceGate useful without a hosted service.
- Preserve enough context for replay and CI.
- Avoid storing secrets in exported traces.
- Treat LangSmith, Langfuse, Braintrust, Phoenix, and OTel backends as downstream views,
  not as TraceGate's source of truth.
