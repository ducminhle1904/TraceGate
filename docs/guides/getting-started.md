# Getting Started

TraceGate provides core contracts, runtime wrappers, policy/redaction defaults, JSONL traces,
matrix testing, replay fixtures, framework adapters, and observability exports.

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

## Local Repo Flow

From this repository:

```bash
pnpm install
pnpm examples:check
pnpm docs:build
```

## What To Expect

- `@tracegate/core` defines contracts, runtime wrappers, trace sinks, and matrix schemas.
- `@tracegate/cli` runs matrix tests through your project-owned `runCase()` function.
- `@tracegate/adapters` connects TraceGate to OpenAI Agents SDK, LangGraph JS,
  OpenTelemetry, Braintrust-style eval rows, and Langfuse-compatible trace events.

## Next Steps

- Start with `examples/basic-tool-policy` to see a blocked risky tool.
- Use `examples/replay-failure` to see deterministic replay.
- Use `examples/openai-agents` or `examples/langgraph-js` if your agent already uses one
  of those frameworks.
