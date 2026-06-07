# Harness Engineering

TraceGate treats agent behavior as a harness contract: the important unit is not only the final answer, but the sequence of tool calls, policy decisions, evidence records, redaction, and trace output that led to that answer.

## Key Points

- Contracts should be checked before side effects happen.
- Tool-call traces should be deterministic enough to replay.
- CI should fail on unsafe behavior drift, not only syntax errors.
- Framework adapters should be thin; the contract model should live in core.

## Phase 0 Status

This concept doc is a skeleton. Phase 1 will define the stable contract types, and Phase 2 will define runtime wrapper semantics.

## Next-Phase TODOs

- Add a diagram of the harness lifecycle.
- Link to the core contract reference once exported types exist.
- Add one end-to-end failing test example.
