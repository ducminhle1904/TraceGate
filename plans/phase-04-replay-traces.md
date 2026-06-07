# Phase 04: Trace Capture And Replay

## Goal

Turn real or local agent traces into deterministic replay fixtures.

## Deliverables

- trace fixture schema
- `tracegate replay`
- `tracegate fixtures create`
- mocked tool result playback
- snapshot-friendly JSONL trace format

## Commands

```bash
tracegate fixtures create traces/prod-failure.jsonl --out fixtures/prod-failure.ts
tracegate replay fixtures/prod-failure.ts
tracegate replay --update
```

## Replay Requirements

- Preserve input prompt, context, tool sequence, policy verdicts, and evidence references.
- Mock external tool outputs unless explicitly configured to live-run.
- Detect drift in:
  - tool selected
  - tool input
  - policy verdict
  - evidence coverage
  - final structured answer
- Allow sensitive fields to be redacted before fixture creation.

## Important Edge Cases

- failed tool call
- repeated tool call
- missing tool result
- client-side tool that resumes later
- stale memory evidence
- malicious retrieval chunk
- high-risk side effect

## Tests

- replay passes with same trace
- replay fails when tool input changes
- replay fails when a blocked tool becomes allowed
- replay fixture redacts secret-like values

## Verification

- `tracegate fixtures create` works from example trace
- `tracegate replay` exits non-zero on a deliberate drift

