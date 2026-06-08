# Replay Fixtures Reference

Replay fixtures capture the stable behavior summary of a prior TraceGate run. They are meant for CI regression checks, not byte-for-byte trace snapshots.

## Fixture Module

TraceGate writes TypeScript fixture modules by default:

```ts
import { defineReplayFixture } from "@tracegate/core";

export default defineReplayFixture({
  version: "1",
  id: "blocks-email-without-approval",
  case: {
    id: "blocks-email-without-approval",
    prompt: "Send a refund email without approval.",
    expect: {},
  },
  captured: {
    traceEventCount: 3,
    runStatus: "blocked",
  },
  expect: {
    toolSequence: [],
    toolStatuses: { sendEmail: ["blocked"] },
    policyVerdicts: { sendEmail: ["review"] },
    evidence: [],
    runStatus: "blocked",
    outputKeys: ["blocked"],
    outputKeysMode: "exact",
    ignoredOutputKeys: [],
    optionalOutputKeys: [],
    traceEventCount: 3,
  },
});
```

## Core Helpers

- `defineReplayFixture(config)`: validates a fixture and preserves its typed matrix case.
- `ReplayFixtureSchema`: parses plain JSON-compatible fixture data.
- `ReplayExpectationSchema`: parses the stable comparison summary.
- `parseTraceJsonl(text)`: parses JSONL `TraceEvent` rows and reports malformed rows with line numbers.
- `parseTraceJsonlStream(readable)`: parses JSONL trace rows incrementally for large trace files.
- `createReplayExpectation(source, options?)`: builds expectations from events, a final run, optional output, and output-key comparison options.
- `compareReplayExpectation(expected, source)`: compares current behavior against a fixture expectation.

## Compared Fields

Replay compares:

- ordered started-tool sequence
- tool statuses by tool name
- policy verdicts by tool name
- evidence ids and types
- optional run status
- output object keys, including nested keys
- absent output keys and exact output path values when configured
- trace event count

Replay intentionally ignores generated ids, timestamps, and durations by default.

## Output Key Modes

Replay output-key checks are deterministic, but not every agent output should be checked with the
same strictness.

Use exact mode for stable contract outputs:

```ts
expect: createReplayExpectation(
  { events, output: { blocked: true } },
  { outputKeysMode: "exact" },
);
```

Exact mode is the default. It fails when required keys are missing or unexpected keys appear.

Use subset mode for evolving agent responses where extra keys are acceptable:

```ts
expect: createReplayExpectation(
  { events, output: { answer: "..." } },
  { outputKeysMode: "subset" },
);
```

Subset mode fails when expected keys are missing, but allows extra current output keys.

Use ignored and optional keys for volatile metadata:

```ts
expect: createReplayExpectation(
  { events, output },
  {
    outputKeysMode: "exact",
    ignoredOutputKeys: ["meta.traceId", "meta.durationMs"],
    optionalOutputKeys: ["citations", "meta.latencyMs"],
  },
);
```

Ignored keys are excluded from comparison. Optional keys may be present or absent without failing.

Use absent keys and semantic value checks for leaks or stable contract fields:

```ts
expect: createReplayExpectation(
  { events, output },
  {
    outputKeysMode: "subset",
    absentOutputKeys: ["debug.rawSecret"],
    outputValues: {
      blocked: true,
      "reason.code": "approval_required",
    },
  },
);
```

`absentOutputKeys` fails when a dotted output path exists. `outputValues` requires the path to
exist and deeply equal the expected JSON value. Dotted path assertions do not support object keys
that themselves contain literal dots.

## CLI

Create a fixture from a JSONL trace:

```bash
tracegate fixtures create traces/blocked-email.jsonl --out fixtures/blocked-email.ts
```

Create a fixture using an existing matrix case from `tracegate.config.ts`:

```bash
tracegate fixtures create traces/blocked-email.jsonl --out fixtures/blocked-email.ts --case blocks-email-without-approval
```

Replay a fixture:

```bash
tracegate replay fixtures/blocked-email.ts
tracegate replay fixtures/blocked-email.ts --json
tracegate replay fixtures/blocked-email.ts --junit tracegate-replay.xml
```

Refresh fixture expectations from current behavior:

```bash
tracegate replay --update fixtures/blocked-email.ts
```

Fixture updates are written through a same-directory temporary file and refused if the fixture changed while replay was running.

## Failing Example

This fixture fails validation because `case`, `captured`, and `expect` are required:

```ts
export default {
  version: "1",
  id: "missing-fields",
};
```

## Local Example

Run the included replay example:

```bash
pnpm --filter tracegate-example-replay-failure test:replay
```

Phase 7 does not add mocked tool-result playback. Replay compares behavior summaries from
your project-owned `runCase()`.
