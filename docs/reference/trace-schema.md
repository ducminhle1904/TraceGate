# Trace Schema Reference

TraceGate traces are designed to be JSONL-friendly. Each row should be a plain JSON object that can be snapshot-tested, exported, or replayed later.

Phase 4 replay reads ordered `TraceEvent` rows, not bare tool records. A replay-compatible JSONL file should contain one event wrapper per line.

## Trace Event Row

```json
{
  "sequence": 1,
  "type": "tool.blocked",
  "timestamp": "2026-06-07T00:00:00.000Z",
  "runId": "run-1",
  "record": {
    "id": "call-1",
    "runId": "run-1",
    "toolName": "sendEmail",
    "timestamp": "2026-06-07T00:00:00.000Z",
    "status": "blocked",
    "riskTier": "high",
    "input": {
      "to": "customer@example.com"
    },
    "policyVerdict": {
      "status": "review",
      "reasons": ["Tool requires approval."],
      "riskTier": "high",
      "toolName": "sendEmail"
    }
  }
}
```

Replay normalization ignores timestamps, generated ids, and durations. It compares stable behavior summaries: started-tool order, tool statuses, policy verdicts, evidence ids/types, optional run status, output keys, and trace event count.

## Tool Call Row

```json
{
  "id": "call-1",
  "runId": "run-1",
  "toolName": "sendEmail",
  "timestamp": "2026-06-07T00:00:00.000Z",
  "status": "succeeded",
  "riskTier": "high",
  "input": {
    "to": "customer@example.com"
  },
  "output": {
    "sent": true
  },
  "policyVerdict": {
    "status": "allow",
    "reasons": ["Required approval is present."],
    "riskTier": "high",
    "toolName": "sendEmail"
  }
}
```

Failing example:

```json
{
  "id": "call-1",
  "toolName": "sendEmail"
}
```

This fails because `runId`, `timestamp`, `status`, and `riskTier` are required.

## Evidence Row

```json
{
  "id": "evidence-1",
  "type": "user-approval",
  "timestamp": "2026-06-07T00:00:00.000Z",
  "content": {
    "approvedBy": "manager"
  },
  "redacted": false
}
```

Failing example:

```json
{
  "id": "evidence-1",
  "type": "unknown",
  "timestamp": "not-a-date"
}
```

This fails because evidence type and timestamp format are invalid.

## Run Record

```json
{
  "id": "run-1",
  "startedAt": "2026-06-07T00:00:00.000Z",
  "status": "succeeded",
  "toolCalls": [],
  "evidence": []
}
```

Failing example:

```json
{
  "id": "run-1",
  "status": "done"
}
```

This fails because `startedAt` is required and `done` is not a valid run status.
