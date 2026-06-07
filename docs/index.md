# TraceGate Docs

TraceGate is a local-first harness for tool-using AI agents. It helps developers define
tool-call contracts, gate risky side effects, redact traces, run matrix tests, and replay
known failures in CI.

## Start Here

- [Getting started](guides/getting-started.md)
- [Tool-call contracts](concepts/tool-call-contracts.md)
- [Runtime semantics](reference/runtime-semantics.md)
- [Matrix file reference](reference/matrix-file.md)
- [Replay](concepts/replay.md)

## Examples

- [Basic tool policy](https://github.com/ducminhle1904/TraceGate/tree/main/examples/basic-tool-policy)
- [Replay failure](https://github.com/ducminhle1904/TraceGate/tree/main/examples/replay-failure)
- [OpenAI Agents SDK](https://github.com/ducminhle1904/TraceGate/tree/main/examples/openai-agents)
- [LangGraph JS](https://github.com/ducminhle1904/TraceGate/tree/main/examples/langgraph-js)

## Positioning

TraceGate complements agent frameworks, observability platforms, eval tools, and gateway
guardrails. It is not a replacement for app authorization, IAM, provider guardrails, or
security review.
