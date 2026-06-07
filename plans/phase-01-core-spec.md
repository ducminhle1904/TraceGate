# Phase 01: Core Harness Spec

## Goal

Define the stable contract layer that all future runtime wrappers, CLI tests, replay fixtures, and integrations use.

## Package

Create `packages/core`.

## Core Concepts

- `HarnessSurface`: app surface or product context where the agent runs
- `HarnessContext`: redacted state passed into the agent
- `ToolContract`: tool manifest, input schema, risk tier, side-effect metadata
- `ToolCallRecord`: normalized tool call event
- `PolicyVerdict`: `allow`, `warn`, `block`, or `review`
- `EvidenceRecord`: retrieval chunks, memory facts, tool outputs, user approvals
- `TraceGateRun`: complete run record
- `MatrixCase`: declarative eval case

## Suggested Files

```text
packages/core/src/
  index.ts
  schema/
    surface.ts
    tool-contract.ts
    trace.ts
    matrix-case.ts
  policy/
    verdict.ts
    evaluate-policy.ts
  evidence/
    evidence.ts
  redaction/
    redact.ts
docs/reference/
  core-contracts.md
  trace-schema.md
```

## Requirements

- Use TypeScript with strict mode.
- Use Zod or a similar runtime schema library.
- Keep schemas serializable to JSON.
- Preserve framework-neutral naming.
- Support JSONL-friendly trace rows.
- Include unit tests for schema parsing and policy verdict behavior.
- Document every exported concept with one sentence, fields, JSON shape, and one failing example.
- Keep docs aligned with actual exported names; do not invent marketing-only types.

## Minimal API Shape

```ts
const contract = defineToolContract({
  name: 'sendEmail',
  riskTier: 'high',
  requiresApproval: true,
  inputSchema: z.object({
    to: z.string().email(),
    subject: z.string(),
    body: z.string(),
  }),
});
```

## Verification

- `pnpm --filter @tracegate/core test`
- `pnpm --filter @tracegate/core type-check`
- `docs/reference/core-contracts.md` covers all exported core schema names
- `docs/reference/trace-schema.md` includes one JSONL row example
