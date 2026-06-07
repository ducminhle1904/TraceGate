# Comparisons

TraceGate is designed to complement existing LLM observability, eval, red-team, and guardrail tools.

## Positioning

| Category | Examples | TraceGate relationship |
| --- | --- | --- |
| Observability | LangSmith, Langfuse, Phoenix, Helicone | Export traces and policy events to them; do not replace their dashboards. |
| Evals | Braintrust, Promptfoo | Add contract-first tool behavior checks and replay fixtures. |
| Gateway guardrails | Portkey, Invariant, Pangea, NeMo Guardrails | Complement request/response or gateway policy with local tool-call contracts. |
| Agent frameworks | OpenAI Agents SDK, LangGraph, Mastra | Wrap tool execution without replacing the framework. |

## TraceGate Focus

- Local-first developer harness.
- Framework-neutral contracts.
- Tool-call policy before execution.
- JSONL traces that can become replay fixtures.
- CI behavior gates.

## Non-Goals

- Hosted observability dashboard.
- Prompt playground.
- Model gateway.
- Agent graph runtime.

## Phase 6 Integrations

- Use `@tracegate/adapters/openai-agents` when your agent already exposes OpenAI Agents SDK
  function tools.
- Use `@tracegate/adapters/langgraph` when your graph already executes LangChain/LangGraph
  structured tools.
- Use `@tracegate/adapters/opentelemetry`, `@tracegate/adapters/braintrust`, or
  `@tracegate/adapters/langfuse` when TraceGate traces need to appear in existing
  observability or eval workflows.
- Keep app authorization, IAM, and provider gateway guardrails in place; TraceGate checks
  local tool-call contracts and side-effect boundaries.
