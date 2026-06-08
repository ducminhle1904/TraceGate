# Runtime Semantics

`@tracegate/core` provides a framework-neutral runtime harness. It wraps existing tool functions; it does not replace the agent framework that decides when a tool should be called.

## Main APIs

- `createHarness(options)`: creates a runtime harness.
- `harness.startRun(input?)`: starts an explicit run and emits `run.started`.
- `harness.finishRun(status?)`: finishes the active run, emits `run.finished`, and flushes the sink.
- `harness.recordEvidence(record)`: validates evidence, auto-fills `timestamp` when omitted, appends it to the active run, and emits `evidence.recorded`.
- `harness.wrapTool(contract, execute)`: returns an async wrapped tool.
- `createMemoryTraceSink()`: stores ordered trace events in memory for tests.
- `createJsonlFileTraceSink(path)`: appends one JSON trace event per line to a local file.

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
- `review` without handler or without approval: do not execute; emit `tool.blocked`; throw `TraceGateReviewRequiredError`.

`PolicyVerdict.diagnostics` may explain contract, policy, approval-handler, and runtime decisions.
The CLI prints these diagnostics in human failure output while JSON and JUnit report shapes stay stable.

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

## Policy Inputs

Custom policy evaluators receive the tool contract, parsed input, current run context, environment, current evidence records, and approval state. This lets `createPolicyEvaluator(definePolicy(...))` require approvals by risk tier and require evidence before side-effecting tools execute.

## Redaction Defaults

TraceGate redacts configured keys and common secret-like string values before writing trace events. Redaction is a deterministic guardrail for common leaks, not a complete DLP system.
