# Framework Adapters

TraceGate adapters connect existing agent frameworks to `@tracegate/core` without replacing
their runtime.

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

## Observability

Adapters also expose downstream views for existing tooling:

- `@tracegate/adapters/opentelemetry`
- `@tracegate/adapters/braintrust`
- `@tracegate/adapters/langfuse`

JSONL remains the local source of truth. Hosted observability systems are downstream
destinations, not required infrastructure.
