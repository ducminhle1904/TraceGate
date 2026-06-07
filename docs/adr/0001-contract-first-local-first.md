# ADR 0001: Contract-First And Local-First

## Status

Accepted for Phase 0.

## Context

Tool-using agents can create side effects that are hard to validate from final text alone. Existing observability tools are valuable for debugging, but TraceGate needs a stable local contract layer that works before data is exported to any external system.

## Decision

TraceGate will start as a contract-first, local-first TypeScript monorepo:

- Core contracts define tool behavior independently of any agent framework.
- Runtime wrappers enforce contracts before tool execution.
- Traces are JSONL-friendly and exportable.
- CLI checks can run in CI without a hosted service.
- Observability integrations are exports, not the product center.

## Consequences

- Phase 0 prioritizes repo shape and docs over runtime features.
- Phase 1 must define stable schema names before adapters exist.
- Adapters should be thin and avoid framework-specific concepts leaking into core.
