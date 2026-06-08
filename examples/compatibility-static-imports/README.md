# TraceGate Compatibility Static Imports

This example verifies package resolution in common project layouts:

- ESM application static imports.
- CJS-ish TypeScript app executed through `tsx`.
- `tracegate.config.ts` loaded through the CLI with static imports.
- Nested workspace package using the same static-import config pattern.

Run:

```bash
pnpm --filter tracegate-example-compatibility-static-imports test:all
pnpm --filter tracegate-example-compatibility-nested-agent test:matrix
```

Expected output:

- `esm static imports ok`
- `tsx static imports ok`
- TraceGate doctor reports package imports and config load as `[OK]`.
- Matrix JSON reports have `status: "passed"`.
