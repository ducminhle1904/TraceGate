# Harness Engineering

TraceGate treats agent behavior as a harness contract: the important unit is not only the final answer, but the sequence of tool calls, policy decisions, evidence records, redaction, and trace output that led to that answer.

## Key Points

- Contracts should be checked before side effects happen.
- Tool-call traces should be deterministic enough to replay.
- CI should fail on unsafe behavior drift, not only syntax errors.
- Framework adapters should be thin; the contract model should live in core.

## Harness Lifecycle

1. Define a `ToolContract` with a stable name, risk tier, and Zod input schema.
2. Create a harness with policy, approval, redaction, and trace sink options.
3. Wrap the real tool with `harness.wrapTool(contract, execute)`.
4. Validate input before execution.
5. Evaluate policy and approval before side effects happen.
6. Record evidence and ordered trace events.
7. Run matrix tests or replay fixtures in CI.

## Why It Matters

Traditional evals often look only at final text. TraceGate checks whether the agent used
the right tools, avoided forbidden tools, preserved evidence, respected policy verdicts,
and kept traces safe enough to store.

## See Also

- [Core contracts reference](../reference/core-contracts.md)
- [Runtime semantics](../reference/runtime-semantics.md)
- [Replay](replay.md)
