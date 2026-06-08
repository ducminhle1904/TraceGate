# Framework Adapters

TraceGate adapters connect existing agent frameworks to `@tracegate/core` without replacing
their runtime.

## Adapter Matrix

| Stack | Import | Runtime mode support | Notes |
| --- | --- | --- | --- |
| Plain functions | `@tracegate/adapters/plain-functions` | `observe`, `shadow`, `enforce` | Best starting point for internal registries. |
| OpenAI Agents SDK | `@tracegate/adapters/openai-agents` | Harness semantics | Creates SDK function tools; use runtime-gate probes at the host boundary for rollout. |
| LangGraph/LangChain | `@tracegate/adapters/langgraph` | Harness semantics | Creates structured tools for ToolNode-style flows. |
| Vercel AI SDK | `@tracegate/adapters/vercel-ai-sdk` | `observe`, `shadow`, `enforce` | Creates AI SDK `tool()` definitions with runtime-gate wrapping. |

Use the templates when you want a runnable stack starter:

```bash
pnpm templates:check
```

## OpenAI Agents SDK

```ts
import { createTraceGateOpenAIAgentsTool } from "@tracegate/adapters/openai-agents";

const tool = createTraceGateOpenAIAgentsTool(contract, execute, { harness });
```

The adapter creates a real OpenAI Agents SDK function tool with the contract name,
description, and Zod input schema. Execution still goes through `harness.wrapTool()`.

Run the local example:

```bash
pnpm --filter tracegate-example-openai-agents start
```

## Plain Function Tools

```ts
import { createTraceGateFunctionRegistry } from "@tracegate/adapters/plain-functions";

const tools = createTraceGateFunctionRegistry(registry, {}, {
  runtimeGateOptions: { mode: "observe" },
});
```

Use this for existing in-process registries before adopting a framework-specific adapter.

## LangGraph JS

```ts
import { createTraceGateLangGraphTool } from "@tracegate/adapters/langgraph";

const tool = createTraceGateLangGraphTool(contract, execute, { harness });
```

The adapter creates a LangChain/LangGraph-compatible structured tool for ToolNode-style
flows. TraceGate validates input and records policy/trace events before and after the
framework executes the tool.

Run the local example:

```bash
pnpm --filter tracegate-example-langgraph-js start
```

## Vercel AI SDK

```ts
import { createTraceGateVercelAITool } from "@tracegate/adapters/vercel-ai-sdk";

export const tools = {
  lookupCustomer: createTraceGateVercelAITool(contract, execute, {
    runtimeGateOptions: { mode: "shadow" },
  }),
};
```

The adapter returns an AI SDK `tool()` object. `ai` is an optional peer dependency, so it is
only required when importing this subpath.

## Production Rollout Ladder

Start with local JSONL traces and move slowly:

1. `observe`: collect summaries and runtime JSONL without blocking.
2. `shadow`: compare TraceGate policy to the host runtime verdict.
3. `enforce` with `validationOnly: true`: prevent malformed tool input before side effects.
4. Targeted `enforce`: scope by `toolNames` and `riskTiers`.

TraceGate does not replace auth, IAM, business authorization, provider guardrails, or human
review. Keep those decisions app-owned and use TraceGate as a tool-boundary harness.

## Observability

Adapters also expose downstream views for existing tooling:

- `@tracegate/adapters/opentelemetry`
- `@tracegate/adapters/braintrust`
- `@tracegate/adapters/langfuse`

JSONL remains the local source of truth. Hosted observability systems are downstream
destinations, not required infrastructure.
