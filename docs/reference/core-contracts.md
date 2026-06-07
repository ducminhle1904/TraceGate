# Core Contracts Reference

This page documents the contract and schema exports from `@tracegate/core`. Runtime harness behavior is covered in [Runtime Semantics](runtime-semantics.md).

## Helpers

### `defineToolContract(config)`

Defines and validates a framework-neutral tool contract.

Fields:

- `name`: stable tool name, starting with a letter and containing no spaces.
- `riskTier`: `read`, `low`, `medium`, `high`, or `critical`.
- `inputSchema`: Zod schema used later to validate tool input.
- `requiresApproval`: optional boolean, defaults to `false`.
- `sideEffects`: optional side-effect metadata.
- `requiredEvidence`: optional evidence labels.
- `metadata`: optional JSON-serializable object.

Failing example:

```ts
defineToolContract({
  name: "send email",
  riskTier: "high",
  inputSchema: EmailInputSchema,
});
```

The name fails because contract names cannot contain spaces.

### `evaluatePolicy(input)`

Evaluates the minimal Phase 1 policy primitive. It does not execute tools.

Fields:

- `contract`: a `ToolContract`.
- `approval`: optional `approved`, `denied`, or `missing`.
- `context`: optional `HarnessContext`; accepted for future policy inputs and does not affect Phase 1 verdicts.

Return shape:

```ts
{
  status: "allow" | "warn" | "block" | "review",
  reasons: string[],
  riskTier: "read" | "low" | "medium" | "high" | "critical",
  toolName: string,
}
```

Review example:

```ts
evaluatePolicy({ contract: highRiskContract });
```

If `highRiskContract.requiresApproval` is true and approval is missing, the verdict is `review`.

### `redactValue(value, options)`

Deterministically redacts configured key names and obvious secret-like keys in plain objects and arrays.

Fields:

- `keys`: extra key names to redact.
- `replacement`: replacement string, defaults to `[REDACTED]`.
- `maxDepth`: recursion limit, defaults to `8`.

Transformation example:

```ts
redactValue({ token: "secret", visible: "ok" });
```

Result:

```ts
{ token: "[REDACTED]", visible: "ok" }
```

## Schemas And Types

### `HarnessSurfaceSchema` / `HarnessSurface`

Identifies the product surface where an agent runs.

Fields: `id`, optional `name`, optional `environment`, optional JSON `metadata`.

Failing example: `{ "id": "" }`.

### `HarnessContextSchema` / `HarnessContext`

Carries redacted run context.

Fields: optional `runId`, `surface`, `userId`, `sessionId`, and JSON `metadata`.

Failing example: `{ "metadata": { "bad": undefined } }`.

### `ToolContractConfigSchema` / `ToolContract`

Validates tool contract configuration and preserves a runtime Zod `inputSchema`.

Fields: `name`, `riskTier`, `inputSchema`, optional `description`, `requiresApproval`, `sideEffects`, `requiredEvidence`, and JSON `metadata`.

Failing example: `{ "name": "1bad", "riskTier": "high" }`.

### `PolicyVerdictSchema` / `PolicyVerdict`

Represents the result of a policy check.

Fields: `status`, `reasons`, `riskTier`, `toolName`.

Failing example: `{ "status": "maybe", "reasons": [] }`.

### `EvidenceRecordSchema` / `EvidenceRecord`

Represents retrieval, memory, tool output, approval, or system evidence.

Fields: `id`, `type`, `timestamp`, optional `source`, optional JSON `content`, `redacted`, optional JSON `metadata`.

Failing example: `{ "id": "e1", "type": "unknown", "timestamp": "not-a-date" }`.

### `ToolCallRecordSchema` / `ToolCallRecord`

Represents one normalized tool-call event.

Fields: `id`, `runId`, `toolName`, `timestamp`, `status`, `riskTier`, optional JSON `input`, optional JSON `output`, optional `error`, optional `policyVerdict`, optional JSON `metadata`.

Failing example: `{ "id": "call-1", "toolName": "sendEmail" }`.

### `TraceGateRunSchema` / `TraceGateRun`

Represents a complete run record.

Fields: `id`, optional `surface`, optional `context`, `startedAt`, optional `finishedAt`, `status`, `toolCalls`, `evidence`, optional JSON `metadata`.

Failing example: `{ "id": "run-1", "status": "done" }`.

### `MatrixCaseSchema` / `MatrixCase`

Represents a declarative eval case.

Fields: `id`, `prompt`, optional `surface`, `expect`, optional JSON `metadata`.

Failing example: `{ "id": "case-1", "prompt": "" }`.
