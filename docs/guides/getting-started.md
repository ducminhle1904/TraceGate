# Getting Started

TraceGate is a CI-first contract, replay, and policy harness for agent tool calls. It provides
core contracts, runtime wrappers, policy/redaction defaults, JSONL traces, matrix testing,
replay fixtures, framework adapters, and observability exports.

## 60-Second Repo Flow

```bash
pnpm install
pnpm build
pnpm --filter tracegate-example-basic-tool-policy test:matrix
pnpm --filter tracegate-example-basic-tool-policy test:replay
```

## What Just Happened

- TraceGate loaded the `sendEmail` tool contract from the basic policy example.
- The policy evaluator returned a `review` verdict for the high-risk call.
- The harness blocked execution before the side-effecting tool ran.
- Replay checked that the stored JSONL behavior still matches the expected fixture.

## New Project Flow

```bash
pnpm add @tracegate/core
pnpm add -D @tracegate/cli
pnpm exec tracegate init
pnpm exec tracegate test
```

## Full Local Verification

From this repository:

```bash
pnpm install
pnpm lint
pnpm type-check
pnpm test
pnpm build
pnpm docs:build
pnpm examples:check
pnpm release:smoke
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
