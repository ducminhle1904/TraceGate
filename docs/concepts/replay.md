# Replay

Replay turns a known TraceGate run into a regression check. Instead of comparing every raw
trace byte, TraceGate compares stable behavior: tool order, tool statuses, policy verdicts,
evidence, run status, output keys, and trace event count.

## Flow

1. Capture a JSONL trace from a local or production-like run.
2. Create a TypeScript fixture with `tracegate fixtures create`.
3. Keep the fixture in the repo.
4. Run `tracegate replay` in CI after prompt, model, code, or policy changes.

## What Replay Ignores

Replay intentionally ignores generated ids, timestamps, and durations. Those values change
between runs and are not useful for behavior regression checks.

## Local Example

```bash
pnpm --filter tracegate-example-replay-failure test:replay
```

The example fixture expects one knowledge-base search, one retrieval evidence record, a
successful run, and output keys named `answer` and `citations`.

## When To Use It

- A production trace showed an unsafe or missing tool call.
- A model or prompt update changed tool ordering.
- Required evidence disappeared from the agent workflow.
- Output shape changed even though final prose looked acceptable.
