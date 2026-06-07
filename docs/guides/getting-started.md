# Getting Started

TraceGate is currently in Phase 0. The repository baseline is installable, but runtime packages are not implemented yet.

## Current Setup

```bash
pnpm install
pnpm type-check
pnpm lint
pnpm test
```

## Planned Flow

```bash
pnpm add @tracegate/core
pnpm add -D @tracegate/cli
tracegate init
tracegate test
```

## What To Expect

- `@tracegate/core` will define contracts and runtime wrappers.
- `@tracegate/cli` will run matrix tests and replay fixtures.
- Adapter packages will connect TraceGate to existing agent frameworks.

## Next-Phase TODOs

- Replace preview commands with real package install commands.
- Add the smallest runnable tool-policy example.
- Add troubleshooting for common setup failures.
