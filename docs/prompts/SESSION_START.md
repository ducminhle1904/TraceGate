# TraceGate Session Prompt

You are working in `/Users/ducmle/Workspace/TraceGate`.

TraceGate is an open-source, developer-first framework for agent harness engineering. The goal is not to build another agent runtime, no-code builder, or observability dashboard. The goal is to help developers turn AI agent behavior into versioned, testable contracts that can run locally and in CI.

## Product Direction

Build TraceGate as "pytest/Playwright for AI agents with tool-call contracts, replay, and policy gates."

Primary users:

- AI application developers
- AI engineers
- platform engineers
- security-conscious teams shipping tool-using agents into production

Do not optimize for non-technical business users or low-code workflow operators in the first release.

## Differentiation

Avoid competing directly with:

- LangGraph, CrewAI, Mastra, Pydantic AI, OpenAI Agents SDK: agent runtimes/frameworks
- Dify, Flowise, n8n, Gumloop, Make, Stack AI: builder/workflow platforms
- Langfuse, Braintrust, LangSmith: observability/eval systems

TraceGate should sit across those tools:

- wrap agent/tool execution
- enforce policy before side effects
- record evidence and provenance
- generate regression cases from traces
- run contract tests in CI
- export traces/eval rows to existing observability tools

## Core Promise

When an agent touches tools, data, files, browser, APIs, databases, money, user accounts, or production systems, TraceGate gives developers a harness contract:

- which tool calls are allowed
- what inputs are valid
- what risk tier applies
- what evidence must exist
- what final answer structure is required
- what must be redacted
- what can be replayed deterministically
- what fails CI

## Working Rules

- Keep the first implementation TypeScript-first.
- Prefer framework adapters over framework replacement.
- Keep the CLI useful before building any UI.
- Keep schema stable and explicit.
- Make examples concrete and runnable.
- Do not overbuild visual workflow features.
- Treat replay and policy gates as the core.

## Suggested Execution Order

1. Read `plans/README.md`.
2. Implement `plans/phase-00-positioning.md`.
3. Continue phases in order.
4. After every phase, update README/docs and run the relevant local verification.
5. Keep commits scoped by phase.

## Initial Repo Shape To Create

Recommended package layout:

```text
packages/
  core/          # contracts, policy engine, trace schema, result types
  cli/           # tracegate CLI
  adapters/      # framework adapters
examples/
  openai-agents/
  langgraph-js/
docs/
  concepts/
  guides/
plans/
```

## First Milestone

The first public milestone is not a full platform. It is a minimal CLI and core SDK that can:

1. define a tool-call contract,
2. wrap a mock agent/tool call,
3. block a forbidden call,
4. record a trace,
5. replay the trace as a fixture,
6. run the fixture as a CI-style test,
7. export a JSONL report.

