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
| `enforce` | Blocks invalid input, `block` verdicts, and unresolved `review` verdicts for tools matching the configured enforcement scope. |

The intended production rollout is:

1. Start with `observe` for every tool.
2. Move high-risk tools to `shadow` and compare current runtime decisions with TraceGate policy.
3. Enforce read-only or validation-only checks first.
4. Enforce medium/high side effects only after approval and evidence behavior is proven in matrix/replay tests.

A simple environment mapping keeps rollout explicit:

```ts
import type { RuntimeGateMode } from "@tracegate/core";

const modeByEnvironment: Record<string, RuntimeGateMode> = {
  local: "observe",
  development: "observe",
  staging: "shadow",
  production: "shadow",
};

const mode = modeByEnvironment[process.env.APP_ENV ?? "local"] ?? "observe";
```

Recommended production defaults:

- Local and development: `observe`.
- Staging: `shadow`.
- Initial production rollout: `observe` or `shadow`.
- Production enforcement: targeted `enforce` with `toolNames`, `riskTiers`, and optionally `validationOnly`.

## Minimal Wrapper

```ts
import {
  createRuntimeGate,
  createStructuredLoggerTraceSink,
  defineToolContractFromManifest,
} from "@tracegate/core";

const gate = createRuntimeGate({
  mode: process.env.TRACEGATE_MODE === "enforce" ? "enforce" : "observe",
  enforcement: {
    toolNames: ["lookupOrder", "issueRefund"],
    riskTiers: ["read", "low"],
    validationOnly: true,
  },
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
        toolExecuted: summary.toolExecuted,
        handlerSkippedReason: summary.handlerSkippedReason,
        sideEffectPrevented: summary.sideEffectPrevented,
        wouldHaveExecutedInShadow: summary.wouldHaveExecutedInShadow,
        enforcementApplied: summary.enforcementApplied,
        validationOnly: summary.validationOnly,
        runId: summary.runId,
        toolCallId: summary.toolCallId,
        hostToolCallId: summary.context?.metadata?.toolCallId,
        episodeId: summary.context?.metadata?.episodeId,
        policyDecisionId: summary.context?.metadata?.policyDecisionId,
        repoRiskTier: summary.contractMetadata?.repoRiskTier,
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
  metadata: (tool) => ({
    repoRiskTier: tool.policy.riskTier,
    permission: tool.policy.permission,
    executionLocation: tool.executionLocation,
  }),
});

export const guardedHandler = gate.wrapTool(contract, existingHandler);
```

`allowlist` and `enforcement.toolNames` solve different rollout problems:

- `allowlist` is a gate inclusion filter. Tools outside the allowlist bypass TraceGate tracing,
  validation, policy evaluation, and summaries.
- `enforcement.toolNames` is an enforcement scope. Matching tools are still traced and summarized
  in `enforce` mode, but TraceGate only blocks calls when the tool name scope, risk tier scope, and
  mode all match.

Use `allowlist` when only part of a host registry is ready for TraceGate. Use
`enforcement.toolNames` when every tool should be observed, but only specific tools should be
blocked.

Runtime gate traces are tool-boundary traces by default. A successful call emits
`tool.started -> tool.succeeded`; a blocked call emits `tool.blocked`. This differs from
`createHarness()`, which owns the whole run lifecycle and emits `run.started` and
`run.finished` around tool events.

If the host app wants harness-like traces for local replay or evidence artifacts, opt in:

```ts
const gate = createRuntimeGate({
  mode: "observe",
  traceRunEvents: true,
  context: {
    sessionId,
    userId,
    metadata: {
      toolCallId,
      episodeId,
      policyDecisionId,
    },
  },
});
```

With `traceRunEvents: true`, a successful runtime gate call emits
`run.started -> tool.started -> tool.succeeded -> run.finished`, and blocked calls emit
`run.started -> tool.blocked -> run.finished`. The summary includes `runId`, `toolCallId`,
redacted `context`, and redacted `contractMetadata`.

`createStructuredLoggerTraceSink()` receives already-redacted `TraceEvent` objects because
redaction happens before the runtime gate writes to the sink. It is a small adapter for
production loggers, not a hosted exporter.

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

```ts
const comparisons = runtimeSummaries.flatMap((summary) =>
  summary.shadowComparison ? [summary.shadowComparison] : [],
);

console.table(summarizePolicyComparisons(comparisons));
```

The summary keys include tool, TraceGate risk tier, and classification. Useful classifications
include `runtime_allow_tracegate_block`, `runtime_block_tracegate_allow`, and
`approval_diagnostics_missing`.

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

## Handler Must Not Execute

For side-effecting tools, the runtime summary is the first-class evidence that the host handler did
or did not run:

```ts
const gate = createRuntimeGate({
  mode: "enforce",
  enforcement: { toolNames: ["sendEmail"], riskTiers: ["high"] },
  onSummary(summary) {
    audit.info({
      toolName: summary.toolName,
      handlerExecuted: summary.handlerExecuted,
      handlerSkippedReason: summary.handlerSkippedReason,
      sideEffectPrevented: summary.sideEffectPrevented,
      finalVerdict: summary.finalVerdict?.status,
    });
  },
});
```

Validation failures, policy blocks, missing review approval, and denied approval all report
`handlerExecuted=false` and `sideEffectPrevented=true` when enforcement applies. In `shadow` mode,
TraceGate never blocks the host handler; use `wouldHaveExecutedInShadow=false` to see that
TraceGate would have prevented the side effect if enforcement were enabled.

## Production Sinks And Replay Boundaries

Use JSONL sinks for local development and CI artifacts by default. In staging or production,
prefer `createStructuredLoggerTraceSink()` wired to your existing logger. The logger sink
receives events after TraceGate has redacted configured keys and common secret-like values.
If you run secret leakage checks on production traces, run them against the post-redaction
event payload.

Runtime gate JSONL is boundary-event data. It can be parsed as normal `TraceEvent` rows, but
absence of `run.started` and `run.finished` is expected unless `traceRunEvents: true` was
enabled.

Create a fixture from a runtime-gate trace:

```bash
tracegate fixtures create traces/runtime-gate.jsonl --runtime-gate --out fixtures/runtime-gate.ts
```

Replay a new runtime-gate trace against that fixture without loading `tracegate.config.ts`:

```bash
tracegate replay-runtime fixtures/runtime-gate.ts --trace traces/current-runtime-gate.jsonl
```

Default runtime-gate fixtures use `traceEventCountMode: "tool-boundary"` and
`toolEventSequenceMode: "ordered-subset"`. This compares stable `tool.*` behavior without
depending on `run.started` / `run.finished` or unrelated extra tool events in production JSONL.
For approval-denied or runtime-block probes, assert the blocked boundary event and verdict rather
than the full event count.

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

For Server-Sent Events, keep the same summary fields compact:

```ts
const gate = createRuntimeGate({
  mode: "enforce",
  enforcement: { toolNames: ["issueRefund"], riskTiers: ["high", "critical"] },
  errorAdapter(error, context) {
    return {
      event: "tracegate.tool.blocked",
      data: {
        ok: false,
        blocked: true,
        toolName: context.summary.toolName,
        riskTier: context.summary.riskTier,
        finalVerdict: context.summary.finalVerdict?.status,
        diagnostics: context.summary.diagnostics,
        message: error instanceof Error ? error.message : String(error),
        toolCallId: context.summary.context?.metadata?.toolCallId,
        episodeId: context.summary.context?.metadata?.episodeId,
      },
    };
  },
});
```

For tool-result envelopes, return the host shape while preserving TraceGate diagnostics:

```ts
const gate = createRuntimeGate({
  mode: "enforce",
  enforcement: { toolNames: ["issueRefund"], riskTiers: ["high"] },
  errorAdapter(error, context) {
    return {
      ok: false,
      blocked: true,
      toolName: context.summary.toolName,
      riskTier: context.summary.riskTier,
      finalVerdict: context.summary.finalVerdict?.status,
      diagnostics: context.summary.diagnostics.map((item) => item.rule),
      message: error instanceof Error ? error.message : String(error),
      toolExecuted: context.summary.toolExecuted,
      enforcementApplied: context.summary.enforcementApplied,
      validationOnly: context.summary.validationOnly,
    };
  },
});
```

## Auth And Business Policy Boundary

TraceGate does not replace application authorization, IAM, broker permissions, business policy,
provider gateway guardrails, or human approval workflows. Keep those checks app-owned.

A production host typically runs:

1. User authentication, tenant authorization, and broker/account permission checks.
2. Existing host business policy or provider guardrails.
3. TraceGate observation, shadow comparison, or targeted enforcement at the tool boundary.
4. Host tool dispatch and app-owned audit logging.

For a NodeTrader-like tool, the broker permission remains app-owned. TraceGate proves that the
agent-facing tool contract has the expected risk tier, approval behavior, evidence requirements,
redaction, trace shape, and replay expectations.

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
