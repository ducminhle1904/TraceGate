# Comparisons

TraceGate is a CI-first contract, replay, and policy harness for agent tool calls. It is designed
to complement existing LLM orchestration, app-builder, observability, eval, red-team, and guardrail
tools.

## Positioning

| Category | Examples | TraceGate relationship |
| --- | --- | --- |
| Agent orchestration | LangGraph, OpenAI Agents SDK, Mastra | Keep ownership of graph/runtime execution; TraceGate wraps tool boundaries and verifies behavior. |
| App builders | Dify and similar workflow builders | Build and operate apps elsewhere; TraceGate stays a developer harness for versioned contracts and CI checks. |
| Observability and evals | Langfuse, LangSmith, Phoenix, Braintrust, Promptfoo | Export traces or eval rows when useful; TraceGate keeps local JSONL, replay fixtures, and policy gates as the source of truth. |
| Gateway guardrails | Portkey, Invariant, Pangea, NeMo Guardrails | Complement request/response or gateway policy with local tool-call contracts before side effects execute. |

## TraceGate Focus

- CI-first developer harness.
- Framework-neutral contracts.
- Tool-call policy before execution.
- JSONL traces that can become replay fixtures.
- Versioned behavior gates that fail pull requests when contracts, policy, or replay expectations drift.

## Non-Goals

- Hosted observability dashboard.
- Prompt playground.
- Model gateway.
- Agent graph runtime.
- No-code application builder.
- Replacement for authorization, IAM, sandboxing, or security review.

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
