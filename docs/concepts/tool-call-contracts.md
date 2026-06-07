# Tool-Call Contracts

A tool-call contract describes what an agent is allowed to call, what input shape is valid, what risk tier applies, what evidence or approval is required, and what trace output should exist afterward.

## Key Points

- Contracts are separate from prompts.
- Risk tiers should map to real side effects.
- Input validation happens before the real tool executes.
- Policy verdicts should be recorded even when a tool is blocked.

## Preview Shape

```ts
defineToolContract({
  name: "issueRefund",
  riskTier: "high",
  requiresApproval: true,
  inputSchema: RefundInputSchema,
});
```

This is preview documentation only. The API will be implemented in a later phase.

## Next-Phase TODOs

- Define the canonical risk tier names.
- Document the JSON shape for serialized contracts.
- Add examples for read-only, user-visible, and high-risk tools.
