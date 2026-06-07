# Phase 00: Positioning And Repository Baseline

## Goal

Create the public identity and baseline repo structure for TraceGate.

TraceGate should be presented as a developer-first harness framework for AI agents, not as an agent builder or runtime.

## Deliverables

- `README.md` with clear positioning
- `LICENSE` using Apache-2.0 or MIT
- `CONTRIBUTING.md`
- `CODE_OF_CONDUCT.md`
- root `package.json`
- `pnpm-workspace.yaml`
- `tsconfig.base.json`
- initial folder layout under `packages/`, `examples/`, and `docs/`
- docs skeleton under `docs/concepts/`, `docs/guides/`, `docs/reference/`, `docs/integrations/`, and `docs/agent-skills/`
- `docs/comparisons.md` explaining how TraceGate complements observability, eval, and guardrail tools
- `docs/adr/0001-contract-first-local-first.md`

## README Outline

- One-line pitch: "TraceGate is a CI-first harness for AI agents with tool-call contracts, replay, and policy gates."
- Problem: demos work, production agents drift.
- What it does:
  - tool-call contracts
  - side-effect policy gates
  - deterministic replay
  - eval matrix tests
  - provenance/evidence checks
  - exports to existing observability tools
- What it is not:
  - not a no-code builder
  - not an agent framework
  - not a Langfuse/Braintrust clone
- Minimal example
- 60-second quickstart placeholder
- Comparison note: TraceGate complements LangSmith, Langfuse, Braintrust, Phoenix, Promptfoo, and gateway guardrails.
- Roadmap

## Design Principles

- Contract-first
- Framework-neutral
- CLI-first
- Side-effect aware
- Redaction by default
- Export-friendly
- Small examples over abstract claims
- Documentation-first
- Agent-assistant friendly without depending on any coding agent

## Docs Baseline

Create placeholder docs with stable intent:

- `docs/concepts/harness-engineering.md`
- `docs/concepts/tool-call-contracts.md`
- `docs/guides/getting-started.md`
- `docs/guides/ci.md`
- `docs/reference/configuration.md`
- `docs/integrations/observability.md`
- `docs/agent-skills/codex.md`
- `docs/agent-skills/claude-code.md`

The agent-skill docs should teach coding agents how to add TraceGate to an existing app, generate matrix cases, and inspect traces without over-editing the host repo.

## Verification

- `pnpm install`
- `pnpm type-check`
- `pnpm lint`
- README has a concrete install/use sketch even if packages are placeholders
- docs skeleton links are valid

For this phase, scripts may be placeholders if packages are not implemented yet, but the repo should install cleanly.
