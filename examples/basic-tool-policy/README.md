# Basic Tool Policy Example

Runnable example showing a high-risk tool call stopped by TraceGate review policy before execution.

```bash
pnpm --filter tracegate-example-basic-tool-policy test:matrix
pnpm --filter tracegate-example-basic-tool-policy test:replay
```

The matrix case expects:

- `sendEmail` is attempted and intercepted.
- policy verdict is `review`.
- output contains `blocked`.
- the raw `secret-token` value is absent from traces.

The example also includes:

- `traces/blocked-email.jsonl`: a replay-compatible JSONL trace.
- `fixtures/blocked-email.ts`: a typed replay fixture for the same behavior.
