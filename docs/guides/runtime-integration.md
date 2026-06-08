# Runtime Integration

TraceGate can sit beside an existing agent runtime without replacing its tool registry,
model loop, or business authorization. Use this path when a production app already has tools
and you want to audit or gradually enforce TraceGate contracts.

## Modes

`createRuntimeGate()` supports four rollout modes:

| Mode | Behavior |
| --- | --- |
| `off` | Calls the host handler directly. No validation, trace, or summary is emitted. |
| `observe` | Validates input, evaluates TraceGate policy, writes redacted traces, and emits summaries, but does not block host execution. |
| `shadow` | Same as observe, plus compares the host runtime verdict with TraceGate's verdict. Use this before enforcement. |
| `enforce` | Blocks invalid input, `block` verdicts, and unresolved `review` verdicts for matching risk tiers. |

The intended production rollout is:

1. Start with `observe` for every tool.
2. Move high-risk tools to `shadow` and compare current runtime decisions with TraceGate policy.
3. Enforce read-only or validation-only checks first.
4. Enforce medium/high side effects only after approval and evidence behavior is proven in matrix/replay tests.

## Minimal Wrapper

```ts
import {
  createRuntimeGate,
  createStructuredLoggerTraceSink,
  defineToolContractFromManifest,
} from "@tracegate/core";

const gate = createRuntimeGate({
  mode: process.env.TRACEGATE_MODE === "enforce" ? "enforce" : "observe",
  enforcement: { riskTiers: ["read", "low"] },
  traceSink: createStructuredLoggerTraceSink({
    log: (event) => logger.info({ event }, "tracegate.tool"),
  }),
  onSummary: (summary) => {
    logger.info(
      {
        toolName: summary.toolName,
        riskTier: summary.riskTier,
        finalVerdict: summary.finalVerdict?.status,
        diagnostics: summary.diagnostics.map((item) => item.rule),
        handlerExecuted: summary.handlerExecuted,
        secretLeakFindingCount: summary.secretLeakFindingCount,
      },
      "tracegate.summary",
    );
  },
});

const contract = defineToolContractFromManifest(manifest, {
  name: (tool) => tool.name,
  riskTier: (tool) => tool.policy.riskTier,
  riskMapping: {
    read: "read",
    persisted_write: "medium",
    trading_action: "high",
    admin_action: "critical",
  },
  inputSchema: (tool) => schemaByToolName[tool.name],
  requiredEvidence: (tool) => [tool.policy.permission],
});

export const guardedHandler = gate.wrapTool(contract, existingHandler);
```

`createStructuredLoggerTraceSink()` receives already-redacted `TraceEvent` objects. It is a
small adapter for production loggers, not a hosted exporter.

## Shadow Comparison

When the host runtime already has policy verdicts, pass `runtimeVerdictEvaluator`:

```ts
const gate = createRuntimeGate({
  mode: "shadow",
  policyEvaluator: traceGatePolicy,
  runtimeVerdictEvaluator: hostRuntimePolicy,
  onSummary(summary) {
    if (summary.shadowComparison?.classifications.includes("runtime_allow_tracegate_block")) {
      logger.warn(summary.shadowComparison, "TraceGate would block a currently allowed tool");
    }
  },
});
```

`comparePolicyVerdicts()` and `summarizePolicyComparisons()` are exported for dashboards or
CI probes that want a compact summary. Generated ids, timestamps, and durations are not part
of the comparison.

In `shadow` mode, TraceGate starts its policy evaluation and the host
`runtimeVerdictEvaluator` concurrently. Keep `runtimeVerdictEvaluator` observational and
side-effect-light; business authorization and audit writes should stay in the host runtime.

## Approval Denied

An approval denial is a final block, not an unresolved review:

```text
policy requires review -> approval handler denies -> final block -> toolExecuted=false
```

Useful diagnostics for this path are:

```text
policy:approval-denied
approval-handler:approval-denied
runtime:execution-skipped
```

Use replay fixtures to lock that behavior before enabling `enforce` for side-effecting tools.

## Error Adapter

Some frameworks expect tools to return a structured payload instead of throwing. Keep TraceGate
errors typed internally, then adapt at the boundary:

```ts
const gate = createRuntimeGate({
  mode: "enforce",
  errorAdapter(error, context) {
    return {
      ok: false,
      blocked: true,
      toolName: context.contract.name,
      reason: error instanceof Error ? error.message : String(error),
      finalVerdict: context.summary.finalVerdict?.status,
    };
  },
});
```

This keeps the host app stable while matrix tests can still inspect trace events and policy
diagnostics.

## CommonJS Hosts

TraceGate is ESM-first. If an existing app still uses CommonJS, Jest, or
`moduleResolution: "node"`, use the CJS lazy loader instead of `require("@tracegate/core")`:

```ts
import type { TraceGateCoreModule } from "@tracegate/core/cjs";

const { loadTraceGateCore } = require("@tracegate/core/cjs") as {
  loadTraceGateCore(): Promise<TraceGateCoreModule>;
};

async function createGate() {
  const { createRuntimeGate, createStructuredLoggerTraceSink } = await loadTraceGateCore();
  return createRuntimeGate({
    mode: "observe",
    traceSink: createStructuredLoggerTraceSink({ log: (event) => logger.info({ event }) }),
  });
}
```

This keeps runtime loading asynchronous at the boundary while preserving typed access to the
TraceGate ESM API.

## Boundaries

TraceGate should guard tool-call behavior and produce local replay evidence. It does not replace
auth, IAM, exchange permissions, business authorization, provider guardrails, or human review
systems. Keep those controls in the app runtime and use TraceGate to prove that agent tools
respect them.
