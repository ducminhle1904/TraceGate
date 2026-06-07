# Tool-Call Contracts

A tool-call contract describes what an agent is allowed to call, what input shape is valid, what risk tier applies, what evidence or approval is required, and what trace output should exist afterward.

## Key Points

- Contracts are separate from prompts.
- Risk tiers should map to real side effects.
- Input validation happens before the real tool executes.
- Policy verdicts should be recorded even when a tool is blocked.

## Core API

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

`defineToolContract()` validates contract metadata and preserves the Zod `inputSchema` for
runtime validation.

Use the contract with `createHarness()` and `harness.wrapTool()`:

```ts
import { createHarness } from "@tracegate/core";

const harness = createHarness();
const issueRefund = harness.wrapTool(refundContract, async (input) => {
  return refundClient.issue(input);
});
```

## Risk Examples

- `read`: search, lookup, retrieval.
- `low`: local formatting or non-mutating data transforms.
- `medium`: user-visible draft creation.
- `high`: email send, refund, database write, deploy.
- `critical`: destructive external mutation or irreversible financial action.
