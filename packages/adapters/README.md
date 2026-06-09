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
import {
  createTraceGateClientFunctionTool,
  createTraceGateFunctionRegistry,
} from "@tracegate/adapters/plain-functions";
import { createTraceGateOpenAIAgentsTool } from "@tracegate/adapters/openai-agents";
import { createTraceGateLangGraphTool } from "@tracegate/adapters/langgraph";
import { createTraceGateVercelAITool } from "@tracegate/adapters/vercel-ai-sdk";
```

- Plain functions: wraps an existing in-process tool registry with `createRuntimeGate()`.
  `createTraceGateClientFunctionTool()` supports pre-call and post-call evidence flows for
  client/host-dispatched tools.
- OpenAI Agents SDK: creates a real function tool with the contract name, description, and
  Zod input schema.
- LangGraph JS: creates a LangChain/LangGraph-compatible structured tool for ToolNode-style
  workflows.
- Vercel AI SDK: creates an AI SDK `tool()` with TraceGate validation, summaries, and JSONL
  traces at the tool boundary.

OpenAI and LangGraph adapters keep harness semantics. Plain function and Vercel adapters use
runtime-gate semantics for `observe`, `shadow`, and targeted `enforce` rollout.

Run local examples:

```bash
pnpm --filter tracegate-example-openai-agents start
pnpm --filter tracegate-example-langgraph-js start
```

Run local stack templates:

```bash
pnpm templates:check
```

Templates cover existing registries, observe mode, shadow comparison, validation-only
enforcement, JSONL traces, and runtime replay without model/API credentials.

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
