# Runtime Semantics

`@tracegate/core` provides a framework-neutral runtime harness. It wraps existing tool functions; it does not replace the agent framework that decides when a tool should be called.

## Main APIs

- `createHarness(options)`: creates a runtime harness.
- `harness.startRun(input?)`: starts an explicit run and emits `run.started`.
- `harness.finishRun(status?)`: finishes the active run, emits `run.finished`, and flushes the sink.
- `harness.recordEvidence(record)`: validates evidence, auto-fills `timestamp` when omitted, appends it to the active run, and emits `evidence.recorded`.
- `harness.wrapTool(contract, execute)`: returns an async wrapped tool.
- `createRuntimeGate(options)`: wraps existing runtime handlers in `off`, `observe`, `shadow`, or `enforce` mode for gradual production rollout.
- `createMemoryTraceSink()`: stores ordered trace events in memory for tests.
- `createJsonlFileTraceSink(path)`: appends one JSON trace event per line to a local file.
- `createStructuredLoggerTraceSink(options)`: forwards redacted trace events to a project-owned logger.

## Tool Wrapper Lifecycle

When a wrapped tool is called:

1. Ensure a run exists. If no run is active, the harness starts one automatically.
2. Validate input with `contract.inputSchema`.
3. Evaluate policy with the configured `policyEvaluator`, defaulting to `evaluatePolicy()`.
4. If the verdict is `review`, call `approvalHandler` when configured. Handlers may return
   `"approved"`, `"denied"`, `"missing"`, or `{ status, reason, metadata }`.
5. Execute the real tool only when the final verdict is `allow` or `warn`.
6. Redact input, output, and error metadata before writing trace events.
7. Emit ordered trace events to the configured sink.

## Verdict Behavior

- `allow`: execute the real tool.
- `warn`: execute the real tool and preserve the warning verdict in trace records.
- `block`: do not execute; emit `tool.blocked`; throw `TraceGatePolicyBlockedError`.
- `review` with approving handler: re-evaluate policy with `approval: "approved"` and execute if final verdict allows.
- `review` with denying handler: re-evaluate policy with `approval: "denied"`; the final verdict is `block`, the tool is not executed, and diagnostics include approval denial plus `runtime/execution-skipped`.
- `review` without handler or without approval: do not execute; emit `tool.blocked`; throw `TraceGateReviewRequiredError`.

`PolicyVerdict.diagnostics` may explain contract, policy, approval-handler, and runtime decisions.
The CLI prints these diagnostics in human failure output while JSON and JUnit report shapes stay stable.

This distinction matters in CI: "policy requires review" is the initial policy decision,
"approval was denied" is the approval-handler result, and "tool was blocked" is the final
runtime outcome. A denied approval is expected to end as `block`, not `review`.

## Side-Effect Safety Evidence

`RuntimeGateSummary` is the side-effect evidence contract for production logging and CI probes:

| Field | Meaning |
| --- | --- |
| `handlerExecuted` | Whether the host handler function ran. |
| `toolExecuted` | Alias-oriented runtime evidence for whether the wrapped tool call reached the handler. |
| `handlerSkippedReason` | Why TraceGate skipped the handler: `validation-failed`, `policy-blocked`, `review-required`, or `approval-denied`. |
| `sideEffectPrevented` | `true` when `enforce` mode blocked before the handler could perform a side effect. |
| `wouldHaveExecutedInShadow` | In `shadow` mode, whether TraceGate would have allowed execution if enforcement had been enabled. |
| `enforcementApplied` | Whether the current tool matched the configured enforcement scope. |
| `validationOnly` | Whether enforcement only blocks invalid input and leaves policy verdicts observational. |
| `preCallVerdict` | The policy verdict before a host or client handler runs. |
| `postCallVerdict` | The policy verdict after post-call evidence is submitted. |
| `runtimeVerdict` | The host runtime's decision, when the host reports one. |
| `evidenceSatisfied` | Whether required evidence was satisfied at the current stage. |
| `sideEffectAlreadyOccurred` | Whether the side effect has already happened outside TraceGate's direct control. |
| `enforceablePreCall` | Whether TraceGate could have blocked this call before the handler. |
| `preventability` | `prevented`, `preventable_pre_call`, `not_preventable_at_pre_call`, `requires_post_call_evidence`, or `observational`. |

Mode semantics:

- `observe`: handlers execute; summary fields explain what TraceGate observed, but
  `sideEffectPrevented=false`.
- `shadow`: handlers execute; `wouldHaveExecutedInShadow=false` is the proof that TraceGate would
  have blocked or reviewed if enforcement were enabled.
- `enforce`: matching validation, policy, review, or approval-denied blocks set
  `handlerExecuted=false` and `sideEffectPrevented=true`.

Use `summarizeSideEffectSafety(summaryOrEvent)` to derive the same compact evidence from a runtime
summary, tool trace event, or tool call record. This is reporting evidence only; app authorization,
IAM, and business policy stay app-owned.

## Multi-Stage Runtime Gate

Server tools use the direct wrapper path:

```ts
const guarded = gate.wrapTool(contract, execute);
```

Client or host-dispatched tools can use the lower-level flow:

```ts
const preflight = await gate.preflightToolCall(contract, input);

// The host may now dispatch a client handler or framework-owned tool call.
const summary = await gate.reconcileToolCall(preflight, {
  output: { saved: true },
  evidence: [invoiceSnapshotEvidence],
  runtimeVerdict: "allow",
  sideEffectAlreadyOccurred: true,
});
```

`preflightToolCall()` validates input and evaluates the preliminary policy without requiring tool
output. It emits `tool.pre_call`. This is the right fit for read and draft tools, and for
pre-call enforcement before side effects.

`reconcileToolCall()` records host output, evidence, and runtime verdict after execution. It emits
submitted `evidence.recorded` events, then `tool.post_call` and `tool.reconciled`. If a client mutation or persisted write already happened,
TraceGate reports `sideEffectAlreadyOccurred=true` and never claims `sideEffectPrevented=true`.

Use `sideEffectClass` on contracts to make preventability explicit:

```ts
defineToolContract({
  name: "createInvoiceDraft",
  riskTier: "medium",
  inputSchema,
  sideEffectClass: "persisted_write",
  requiredEvidence: ["invoice_snapshot"],
});
```

Supported classes are `read`, `draft`, `client_mutation`, `persisted_write`, and
`external_side_effect`. If `persisted_write` or `external_side_effect` requires evidence that only
exists after the handler runs, TraceGate reports `requires_post_call_evidence` or
`not_preventable_at_pre_call`. That is product truth, not a TraceGate failure.

## Error Behavior

- Invalid input throws `TraceGateInputValidationError`; the real tool is not called.
- Blocked policy throws `TraceGatePolicyBlockedError`; the real tool is not called.
- Missing review approval throws `TraceGateReviewRequiredError`; the real tool is not called.
- Real tool failure emits `tool.failed` and throws `TraceGateToolExecutionError` with the original error as `cause`.

## Event Ordering

An allowed tool call emits:

```text
run.started
tool.started
tool.succeeded
run.finished
```

A blocked or invalid tool call emits:

```text
run.started
tool.blocked
```

Each event has a monotonically increasing `sequence` number.

## Trace Sinks

`TraceSink` accepts ordered `TraceEvent` objects:

```ts
interface TraceSink {
  write(event: TraceEvent): Promise<void> | void;
  flush?(): Promise<void> | void;
}
```

The memory sink is useful for tests. The JSONL file sink is intended for local development traces and writes parseable JSON lines.
The structured logger sink is intended for app loggers; it emits the same redacted `TraceEvent`
objects and performs no network export by itself.

## Runtime Gate Rollout

Use `createRuntimeGate()` when an app already has a mature tool runtime and cannot switch every
tool to `createHarness()` at once.

- `off`: call the host handler directly.
- `observe`: validate, evaluate policy, trace, and summarize without blocking execution.
- `shadow`: observe plus compare a host runtime verdict with TraceGate's verdict.
- `enforce`: block invalid input and blocking/review verdicts for tools in the configured
  enforcement scope.

`enforcement` can target by tool name, risk tier, or both:

```ts
const gate = createRuntimeGate({
  mode: "enforce",
  enforcement: {
    toolNames: ["lookupOrder", "issueRefund"],
    riskTiers: ["read", "high"],
    validationOnly: false,
  },
});
```

All configured scopes must match before enforcement blocks a call. `validationOnly: true` means
TraceGate blocks invalid input for matching tools, but does not block policy `review` or `block`
verdicts. `allowlist` is different: it is a trace/gate inclusion filter. Tools outside the
allowlist bypass TraceGate validation, policy evaluation, tracing, and summaries.

`errorAdapter` can translate TraceGate runtime errors into framework-specific tool-result
payloads. This is useful for agent frameworks that expect a tool response instead of an exception.

See [Runtime integration](../guides/runtime-integration.md) for rollout patterns.

## Policy Inputs

Custom policy evaluators receive the tool contract, parsed input, current run context, environment, current evidence records, and approval state. This lets `createPolicyEvaluator(definePolicy(...))` require approvals by risk tier and require evidence before side-effecting tools execute.

## Redaction Defaults

TraceGate redacts configured keys and common secret-like string values before writing trace events. Redaction is a deterministic guardrail for common leaks, not a complete DLP system.
