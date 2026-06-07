# Getting Started

TraceGate currently provides core contracts, runtime wrappers, and a matrix-test CLI.

## Current Setup

```bash
pnpm install
pnpm type-check
pnpm lint
pnpm test
```

## Local Matrix Flow

```bash
pnpm add @tracegate/core
pnpm add -D @tracegate/cli
tracegate init
tracegate test
```

## What To Expect

- `@tracegate/core` defines contracts, runtime wrappers, trace sinks, and matrix schemas.
- `@tracegate/cli` runs matrix tests through your project-owned `runCase()` function.
- Adapter packages will connect TraceGate to existing agent frameworks.

## Next-Phase TODOs

- Add replay fixtures after Phase 4.
- Add framework adapter examples after adapter packages exist.
- Add troubleshooting for common setup failures.
