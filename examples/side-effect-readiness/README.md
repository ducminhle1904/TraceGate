# Side-Effect Readiness Example

This example is the canonical TraceGate proof that side-effecting handlers did or did not run.

```bash
pnpm --filter tracegate-example-side-effect-readiness check
```

It covers four runtime-gate probes:

- validation failure before handler execution
- approval denied before handler execution
- policy block before handler execution
- shadow mode where the host handler executes but TraceGate records that enforcement would have blocked

Each probe writes a boundary JSONL trace and a `traceRunEvents: true` JSONL trace. The checked-in
fixtures use `traceEventCountMode: "tool-boundary"` and `toolEventSequenceMode: "ordered-subset"`
so replay focuses on stable `tool.*` behavior rather than run lifecycle noise.
