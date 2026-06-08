# @tracegate/core

Core contracts, schemas, and policy primitives for TraceGate.

TraceGate core includes framework-neutral contracts, runtime wrapping, configurable policy defaults, redaction, replay fixture contracts, trace sinks, and matrix case schemas.

Use `createHarness()` and `wrapTool()` to validate tool input, evaluate policy, redact traces, record evidence, and emit ordered trace events.
Use `createRuntimeGate()` when you need to observe, shadow, or enforce TraceGate behavior around
an existing production tool dispatcher before migrating to a full harness integration.

## Install

```bash
pnpm add @tracegate/core
```

## Example

```ts
import { createHarness, defineToolContract } from "@tracegate/core";
import { z } from "zod";

const contract = defineToolContract({
  name: "searchKnowledgeBase",
  riskTier: "read",
  inputSchema: z.object({ query: z.string() }),
});

const harness = createHarness();
const searchKnowledgeBase = harness.wrapTool(contract, async ({ query }) => {
  return { query, hits: [] };
});
```

## Exports

- tool contracts and risk tiers
- manifest and registry contract adapters
- harness runtime and trace sinks
- runtime gate rollout helpers
- policy and approval helpers
- structured policy diagnostics
- redaction and placeholder-aware secret-leak detection
- standalone evidence record creation
- matrix case schemas
- replay fixture schemas, flexible output assertions, and JSONL parsers
