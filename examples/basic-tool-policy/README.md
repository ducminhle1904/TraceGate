# Basic Tool Policy Example

## Purpose

Shows a high-risk tool call stopped by TraceGate review policy before execution.

## Run

```bash
pnpm --filter tracegate-example-basic-tool-policy test:matrix
pnpm --filter tracegate-example-basic-tool-policy test:replay
```

## Expected Output

Both commands print JSON reports with `status: "passed"` and zero failures.

## Why This Matters In CI

This is the smallest proof that a risky tool contract, policy verdict, redaction check, and replay
fixture can fail or pass a pull request without calling a model provider.

## Demonstrates

- `sendEmail` is attempted and intercepted.
- policy verdict is `review`.
- output contains `blocked`.
- the raw `secret-token` value is absent from traces.

The example also includes:

- `traces/blocked-email.jsonl`: a replay-compatible JSONL trace.
- `fixtures/blocked-email.ts`: a typed replay fixture for the same behavior.
