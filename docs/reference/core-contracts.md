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

Evaluates the minimal default policy primitive. It does not execute tools.

Fields:

- `contract`: a `ToolContract`.
- `approval`: optional `approved`, `denied`, or `missing`.
- `context`: optional `HarnessContext`.
- `environment`: optional runtime environment.
- `evidence`: optional evidence records.
- `input`: optional parsed tool input.

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

### `definePolicy(config)` / `createPolicyEvaluator(policy)`

Defines configurable policy defaults for side-effecting tools.

Fields:

- `requireApprovalForRiskTiers`: risk tiers that require approval.
- `blockRiskTiers`: risk tiers that are always blocked.
- `environmentOverrides`: environment-specific policy rules.
- `toolOverrides`: tool-specific policy rules.
- `requiredEvidence`: evidence labels required by tool name.

Example:

```ts
createPolicyEvaluator(
  definePolicy({
    requireApprovalForRiskTiers: ["high", "critical"],
    requiredEvidence: {
      issueRefund: ["manager"],
    },
  }),
);
```

### `redactValue(value, options)`

Deterministically redacts configured key names, obvious secret-like keys, and common secret-like string values in plain objects and arrays.

Fields:

- `keys`: extra key names to redact.
- `patterns`: extra regular expressions to redact from string values.
- `detect`: set to `false` to disable value-pattern redaction.
- `preserveLength`: preserve matched string length when replacing value matches.
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

### `detectSecretLikeValues(value, options)` / `assertNoSecretLikeValues(value, options)`

Detects common secret-like string values and reports stable findings with `path`, `kind`, and `preview`.

`assertNoSecretLikeValues()` throws `TraceGateSecretLeakError` when findings exist.

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

### `defineMatrix(cases)`

Parses a list of matrix cases and returns typed `MatrixCase[]`.

Failing example: `defineMatrix([{ id: "case-1", prompt: "" }])`.

### `MatrixCaseSchema` / `MatrixCase`

Represents a declarative eval case.

Fields: `id`, `prompt`, optional `surface`, `expect`, optional JSON `metadata`.

Expectation fields: `requiredTools`, `forbiddenTools`, `orderedToolSequence`, `requiredPolicyVerdict`, `requiredEvidence`, `outputKeys`, `redactionChecks`, and `toolInputIncludes`.

Failing example: `{ "id": "case-1", "prompt": "" }`.
