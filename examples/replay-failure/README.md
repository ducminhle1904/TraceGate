# Replay Failure Example

## Purpose

Shows how a JSONL trace becomes a deterministic replay fixture, then reruns the same
matrix case against the current project-owned `runCase()`.

## Run

```bash
pnpm --filter tracegate-example-replay-failure test:replay
```

To regenerate a fixture from the included trace:

```bash
pnpm --filter tracegate-example-replay-failure fixtures:create
```

## Expected Output

The replay command prints a JSON report with `status: "passed"`, one case, five trace
events, and zero failures.

## Why This Matters In CI

Replay catches drift when code, prompts, model behavior, or dependencies change the tool-call
sequence or output shape that a reviewed trace fixture expects.

## Demonstrates

- JSONL trace parsing.
- TypeScript replay fixture loading.
- Tool sequence comparison.
- Required evidence checks.
- Output-shape drift checks.
