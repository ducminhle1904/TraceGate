# Manifest Adapter Example

Shows how a project with an existing tool registry can generate TraceGate contracts without
rewriting every manifest by hand.

It demonstrates:

- Custom internal risk tiers: `safe`, `broker_write`, `destructive`.
- Mapping internal tiers to TraceGate risk tiers.
- Pulling permissions into `requiredEvidence`.
- Preserving schema, side-effect metadata, and manifest metadata.
- Applying per-tool overrides without mutating the original manifest.

Run:

```bash
pnpm --filter tracegate-example-manifest-adapter start
```

Expected output:

- `broker_write` maps to `high`
- read-only tools do not require approval
- broker-write tools require approval and evidence
- overrides add `manager-approval`
