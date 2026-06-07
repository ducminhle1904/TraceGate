# Observability Integrations

TraceGate should complement existing observability tools by producing structured contract and trace data that can be exported elsewhere.

## Initial Export Targets

- JSONL.
- OpenTelemetry spans.
- Braintrust-compatible eval rows.
- Langfuse trace or event mirrors.

## Integration Principles

- Do not make observability the product center.
- Keep TraceGate useful without a hosted service.
- Preserve enough context for replay and CI.
- Avoid storing secrets in exported traces.

## Next-Phase TODOs

- Define a trace sink interface.
- Add JSONL examples.
- Add export mapping notes for Langfuse, LangSmith, Braintrust, and Phoenix.
