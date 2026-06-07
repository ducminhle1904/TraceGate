# @tracegate/adapters

Framework adapters and observability exports for TraceGate.

Adapters stay thin: `@tracegate/core` remains the source of truth for contract validation,
policy, approval, evidence, redaction, and trace semantics.

## Install

```bash
pnpm add @tracegate/adapters
```

## Framework Adapters

```ts
import { createTraceGateOpenAIAgentsTool } from "@tracegate/adapters/openai-agents";
import { createTraceGateLangGraphTool } from "@tracegate/adapters/langgraph";
```

- OpenAI Agents SDK: creates a real function tool with the contract name, description, and
  Zod input schema.
- LangGraph JS: creates a LangChain/LangGraph-compatible structured tool for ToolNode-style
  workflows.

Both adapters accept either an existing `harness` or `harnessOptions`.

Run local examples:

```bash
pnpm --filter tracegate-example-openai-agents start
pnpm --filter tracegate-example-langgraph-js start
```

## Observability Exports

```ts
import { createOpenTelemetryTraceSink } from "@tracegate/adapters/opentelemetry";
import { toBraintrustEvalRows } from "@tracegate/adapters/braintrust";
import { toLangfuseTraceEvents } from "@tracegate/adapters/langfuse";
```

- OpenTelemetry sink emits one span per TraceGate event with stable `tracegate.*`
  attributes.
- Braintrust mapper emits JSON-serializable eval rows from matrix/replay results.
- Langfuse mapper emits trace/event payloads and a no-op-by-default sink.

No exporter sends network data unless the caller provides a configured SDK/exporter writer.

JSONL traces remain the local source of truth for replay and CI.
