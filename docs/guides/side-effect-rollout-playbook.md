# Side-Effect Rollout Playbook

Use TraceGate as a boundary harness while your app remains the source of truth for auth, IAM,
business policy, broker permissions, and rollback.

## Rollout Ladder

1. Probe: add contracts and record runtime summaries without blocking.
2. Observe: run `createRuntimeGate({ mode: "observe" })` and inspect `RuntimeGateSummary`.
3. Shadow: compare host runtime verdicts with TraceGate policy using `mode: "shadow"`.
4. Low-risk validation enforce: use `mode: "enforce"` with `validationOnly: true`.
5. Selected side-effect enforce: scope by `toolNames` and `riskTiers` for tools with replay fixtures.

## Readiness Checklist

- Tool contracts are mapped from the real registry.
- Host risk tiers are mapped to TraceGate risk tiers and preserved in metadata.
- `sideEffectClass` is set for client mutations, persisted writes, and external side effects.
- Required evidence is defined for side-effecting tools.
- Runtime replay fixtures are committed for approval-denied, validation-block, policy-block, and
  post-call evidence paths.
- Redaction checks pass before traces leave local/CI environments.
- Production logging uses structured logger, OpenTelemetry, Langfuse, or a custom sink.
- Rollback remains app-owned; TraceGate does not roll back side effects that already occurred.

## Summary Fields To Watch

- `enforcementEligible` and `enforcementEligibilityReason`: whether a tool can be blocked by the
  current runtime gate configuration.
- `handlerExecuted` and `toolExecuted`: whether the host handler actually ran.
- `sideEffectPrevented`: whether TraceGate blocked before the handler could perform a side effect.
- `preventability`: whether the path was pre-call preventable, post-call evidence only, or
  observational.
- `shadowComparison`: whether TraceGate would disagree with the host runtime verdict.

## Runtime Fixture Command

```bash
tracegate runtime record \
  --trace traces/runtime.jsonl \
  --summary traces/runtime-summaries.jsonl \
  --out fixtures/runtime.ts \
  --case-id runtime-side-effect-probe

tracegate replay-runtime fixtures/runtime.ts --trace traces/current-runtime.jsonl
```
