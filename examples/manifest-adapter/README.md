# Manifest Adapter Example

Shows how a project with an existing tool registry can generate TraceGate contracts without
rewriting every manifest by hand.

It demonstrates:

- Custom internal risk tiers: `safe`, `broker_write`, `destructive`.
- Mapping internal tiers to TraceGate risk tiers.
- Pulling permissions into `requiredEvidence`.
- Preserving schema, side-effect metadata, and manifest metadata.
- Applying per-tool overrides without mutating the original manifest.
- Adapting generic Zod registries, MCP-style manifests, and framework descriptors without
  overfitting to one application.

Run:

```bash
pnpm --filter tracegate-example-manifest-adapter start
```

Expected output:

- `broker_write` maps to `high`
- read-only tools do not require approval
- broker-write tools require approval and evidence
- overrides add `manager-approval`

## Descriptor Shapes

Generic Zod registry:

```ts
createToolContractAdapter({
  name: (tool) => tool.id,
  riskTier: (tool) => tool.internalRisk,
  riskMapping: { safe: "read", broker_write: "high", destructive: "critical" },
  inputSchema: (tool) => tool.schema,
});
```

MCP-style manifest:

```ts
defineToolContractFromManifest(manifest, {
  name: (tool) => tool.name,
  description: (tool) => tool.description,
  riskTier: (tool) => tool.annotations?.risk ?? "read",
  riskMapping: { read: "read", write: "high" },
  fallbackRiskTier: "medium",
  inputSchema: (tool) => tool.inputSchema,
});
```

OpenAI or LangGraph-style descriptor:

```ts
defineToolContractFromManifest(descriptor, {
  name: (tool) => tool.name,
  description: (tool) => tool.description,
  riskTier: (tool) => tool.metadata?.risk,
  riskMapping: { safe: "read", user_write: "medium", external_write: "high" },
  inputSchema: (tool) => tool.parameters,
  metadata: (tool) => ({ source: tool.metadata?.source ?? "agent-tool-registry" }),
});
```

NodeTrader-style registry with separate Zod schemas:

```ts
const schemas = {
  readPosition: ReadPositionInput,
  placeOrder: PlaceOrderInput,
};

defineToolContractFromManifest(manifest, {
  name: (tool) => tool.name,
  description: (tool) => tool.description,
  riskTier: (tool) => tool.policy.riskTier,
  riskMapping: {
    read: "read",
    draft: "medium",
    canvas_mutation: "medium",
    persisted_write: "medium",
    trading_action: "high",
    admin_action: "critical",
  },
  inputSchema: (tool) => schemas[tool.name],
  requiresApproval: (tool) =>
    tool.policy.riskTier === "trading_action" || tool.policy.riskTier === "admin_action",
  requiredEvidence: (tool) => [tool.policy.permission],
  metadata: (tool) => ({
    permission: tool.policy.permission,
    executionLocation: tool.executionLocation,
  }),
});
```

TraceGate records and tests policy expectations around these contracts. It does not replace
application authorization, IAM, exchange permissions, or business approval rules.
