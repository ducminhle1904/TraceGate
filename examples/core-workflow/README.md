# Core Workflow Example

Shows the framework-neutral TraceGate runtime without any model or provider dependency.

It demonstrates:

- A read-only tool that executes normally.
- A high-risk side-effect tool that is denied by approval policy.
- Validation failure before a tool executor is called.
- JSONL trace writing through `createJsonlFileTraceSink()`.
- Default redaction of an `apiKey` input field.
- Placeholder-aware redaction fixture checks for already-redacted traces.

Run:

```bash
pnpm --filter tracegate-example-core-workflow start
pnpm --filter tracegate-example-core-workflow test:redaction
```

Expected output:

- `blocked: true`
- `validationBlocked: true`
- `sideEffectExecutions: 0`
- ordered TraceGate runtime events
- `redacted: true`
- `rawSecretFails: true`
- `redactedPlaceholderPasses: true`
- a local trace at `traces/core-workflow.jsonl`
