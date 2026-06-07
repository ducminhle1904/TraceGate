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

## Next-Phase TODOs

- Add concrete export examples.
- Add a decision guide for teams already using observability tools.
- Add integration diagrams after adapters exist.
