# Phase 06: Integrations And Observability Exports

## Goal

Make TraceGate work with existing agent frameworks and observability tools without replacing them.

## Framework Adapters

Start with:

- OpenAI Agents SDK for JavaScript
- LangGraph JS

Later:

- Mastra
- Pydantic AI
- CrewAI
- MCP tools

## Export Targets

Start with:

- JSONL
- OpenTelemetry spans
- Braintrust-compatible eval rows
- Langfuse trace/event mirror

Later:

- LangSmith-compatible metadata where feasible

## Adapter Rules

- Adapters should be thin.
- Core policy and trace semantics must live in `packages/core`.
- Do not couple TraceGate to one model provider.
- Do not require framework migration.

## Example Adapter Shape

```ts
const agent = withTraceGate(openAiAgent, {
  harness,
  tools: [sendEmailContract],
});
```

## Tests

- adapter records normalized tool calls
- adapter preserves framework result
- adapter blocks high-risk tool before framework executes it
- export rows are stable and schema-valid

## Verification

- runnable OpenAI Agents example
- runnable LangGraph JS example
- exported JSONL can be inspected by CLI

