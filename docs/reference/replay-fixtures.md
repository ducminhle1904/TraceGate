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
- `createReplayExpectation(source)`: builds expectations from events, a final run, and optional output.
- `compareReplayExpectation(expected, source)`: compares current behavior against a fixture expectation.

## Compared Fields

Replay compares:

- ordered started-tool sequence
- tool statuses by tool name
- policy verdicts by tool name
- evidence ids and types
- optional run status
- output object keys, including nested keys
- trace event count

Replay intentionally ignores generated ids, timestamps, and durations by default.

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

## Next-Phase TODOs

- Add optional mocked tool-result playback.
- Add fixture diff output for larger regressions.
- Add adapter-specific capture guides once adapters exist.
