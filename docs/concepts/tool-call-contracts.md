# Tool-Call Contracts

A tool-call contract describes what an agent is allowed to call, what input shape is valid, what risk tier applies, what evidence or approval is required, and what trace output should exist afterward.

## Key Points

- Contracts are separate from prompts.
- Risk tiers should map to real side effects.
- Input validation happens before the real tool executes.
- Policy verdicts should be recorded even when a tool is blocked.

## Phase 1 API

```ts
import { defineToolContract } from "@tracegate/core";
import { z } from "zod";

const RefundInputSchema = z.object({
  orderId: z.string(),
  amount: z.number().positive(),
});

defineToolContract({
  name: "issueRefund",
  riskTier: "high",
  requiresApproval: true,
  inputSchema: RefundInputSchema,
});
```

`defineToolContract()` is implemented in Phase 1. It validates contract metadata and preserves the Zod `inputSchema` for later runtime validation.

Runtime APIs such as `createHarness()` and `wrapTool()` are still planned for Phase 2.

## Next-Phase TODOs

- Document the JSON shape for serialized contract summaries.
- Add examples for read-only, user-visible, and high-risk tools.
