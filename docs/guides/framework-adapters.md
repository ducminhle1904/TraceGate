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

Every template prints the same side-effect readiness fields:

```ts
{
  handlerExecuted: summary.handlerExecuted,
  toolExecuted: summary.toolExecuted,
  handlerSkippedReason: summary.handlerSkippedReason,
  sideEffectPrevented: summary.sideEffectPrevented,
  enforcementEligible: summary.enforcementEligible,
  enforcementEligibilityReason: summary.enforcementEligibilityReason,
  wouldHaveExecutedInShadow: summary.wouldHaveExecutedInShadow,
  preCallVerdict: summary.preCallVerdict?.status,
  postCallVerdict: summary.postCallVerdict?.status,
  runtimeVerdict:
    typeof summary.runtimeVerdict === "string"
      ? summary.runtimeVerdict
      : summary.runtimeVerdict?.status,
  evidenceSatisfied: summary.evidenceSatisfied,
  sideEffectAlreadyOccurred: summary.sideEffectAlreadyOccurred,
  preventability: summary.preventability,
}
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
  onSummary(summary) {
    console.log({
      toolName: summary.toolName,
      handlerExecuted: summary.handlerExecuted,
      sideEffectPrevented: summary.sideEffectPrevented,
    });
  },
});
```

Use this for existing in-process registries before adopting a framework-specific adapter.

For client tools where the host dispatches the handler later, use the client flow:

```ts
import { createTraceGateClientFunctionTool } from "@tracegate/adapters/plain-functions";

const tool = createTraceGateClientFunctionTool(contract, {
  runtimeGateOptions: { mode: "observe", policyEvaluator },
});

const preflight = await tool.preflight(input);
const summary = await tool.reconcile(preflight, {
  output: clientResult,
  evidence: [invoiceSnapshotEvidence],
  runtimeVerdict: "allow",
  sideEffectAlreadyOccurred: true,
});
```

This records `tool.pre_call`, `tool.post_call`, and `tool.reconciled` events for runtime replay.

## Custom Agent Runtime

For custom dispatchers, wrap the boundary where the runtime is about to call a project-owned tool:

```ts
import { createRuntimeGate, createRuntimeReplayRecorder } from "@tracegate/core";

const recorder = createRuntimeReplayRecorder();
const gate = createRuntimeGate({
  mode: "shadow",
  traceSink: recorder.traceSink,
  onSummary: recorder.onSummary,
  runtimeVerdictEvaluator: hostPolicyEvaluator,
});

const guarded = gate.wrapTool(contract, existingToolHandler);
const result = await guarded(input);
const fixture = recorder.toFixture({ id: "custom-runtime-probe" });
```

Persist the fixture in CI, then compare new runtime traces with `tracegate replay-runtime`.

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
    onSummary(summary) {
      console.log(summary.wouldHaveExecutedInShadow);
    },
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
