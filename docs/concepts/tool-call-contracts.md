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

If your project already has a tool registry, convert manifests instead of rewriting every
contract by hand:

```ts
import { createToolContractAdapter } from "@tracegate/core";

const fromManifest = createToolContractAdapter({
  name: (tool) => tool.id,
  riskTier: (tool) => tool.internalRisk,
  riskMapping: {
    safe: "read",
    broker_write: "high",
    destructive: "critical",
  },
  inputSchema: (tool) => tool.schema,
  requiredEvidence: (tool) => tool.permissions,
});
```

Keep the mapping explicit. Internal labels should describe your product domain; TraceGate tiers
describe framework-neutral execution risk.

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
