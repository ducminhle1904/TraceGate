# Nested Agent Compatibility Fixture

This package is intentionally nested below an example workspace to verify that
`tracegate.config.ts` can statically import TraceGate packages from a deeper package root.

Run:

```bash
pnpm --filter tracegate-example-compatibility-nested-agent test:all
```
