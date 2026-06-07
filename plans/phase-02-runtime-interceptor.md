# Phase 02: Runtime Interceptor

## Goal

Build the framework-neutral SDK layer that wraps tool execution and records policy/evidence/trace events.

## Package

Continue in `packages/core`, then expose adapter hooks from `packages/adapters` later.

## Deliverables

- `createHarness()`
- `harness.wrapTool()`
- `harness.recordEvidence()`
- `harness.startRun()`
- `harness.finishRun()`
- pluggable trace sink interface
- pluggable approval handler interface
- pluggable policy evaluator interface
- runtime semantics doc for allow/block/review/error behavior
- minimal local JSONL trace sink

## Behavior

Before a tool call:

- validate input schema
- evaluate risk tier and policy
- apply redaction preview
- block or request review if required

During a tool call:

- record start event
- capture bounded metadata
- avoid storing secrets

After a tool call:

- record result envelope
- classify success/failure
- attach evidence
- emit trace row

## Minimal Example

```ts
const harness = createHarness({
  surface: 'support-dashboard',
  contracts: [sendEmailContract],
  policy: {
    maxRiskTierWithoutApproval: 'medium',
  },
});

const sendEmail = harness.wrapTool('sendEmail', async (input) => {
  return emailClient.send(input);
});
```

## Tests

- allowed low-risk call runs
- blocked high-risk call does not execute
- schema-invalid call fails before execution
- redacted fields are not written to trace
- trace sink receives ordered events
- runtime docs match the observable order of emitted trace events

## Verification

- `pnpm --filter @tracegate/core test`
- Add a small example script and run it locally.
- `docs/reference/runtime-semantics.md` documents wrapper lifecycle and failure modes
