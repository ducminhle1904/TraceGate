# TraceGate Implementation Plan

This folder breaks the TraceGate build into phase files. Each phase should be implementable as a focused session or commit series.

## Phase Index

- `phase-00-positioning.md`: product definition, repo scaffold, README, license, contribution baseline
- `phase-01-core-spec.md`: harness contract schema, trace schema, policy verdict types, reference docs
- `phase-02-runtime-interceptor.md`: SDK wrapper for tool calls, framework-neutral execution hooks, runtime semantics docs
- `phase-03-eval-matrix-cli.md`: CLI runner, test matrix DSL, CI-friendly reporting, CI docs
- `phase-04-replay-traces.md`: trace capture, fixture generation, deterministic replay
- `phase-05-policy-redaction-security.md`: risk tiers, approval contracts, redaction, secret leakage checks
- `phase-06-integrations-observability.md`: adapters and exports for LangGraph/OpenAI Agents/Langfuse/Braintrust/OpenTelemetry
- `phase-07-examples-docs-launch.md`: examples, docs, agent skills, public launch polish

## Documentation Strategy

Docs are part of the product surface, not a launch-only task. Every phase should update at least one of:

- public README or quickstart
- concept docs explaining the design contract
- API reference docs for exported types/functions
- guide docs for one real workflow
- agent-facing skill/prompt docs for Codex, Claude Code, and similar coding agents

Agent skills should help coding agents integrate TraceGate into an existing repo, generate matrix cases from traces, and propose policy/redaction rules. They should not make TraceGate depend on a specific coding agent.

## Non-Goals

- Do not build a no-code workflow builder.
- Do not create another graph runtime.
- Do not require developers to migrate away from their current agent framework.
- Do not make observability the product center; export to existing observability tools instead.
- Do not position TraceGate as a replacement for LangSmith, Langfuse, Braintrust, Phoenix, Promptfoo, or gateway guardrails.

## Success Criteria

TraceGate should become useful when a developer asks:

- "Can I prove this agent will not call a dangerous tool?"
- "Can I replay the production failure?"
- "Can I fail CI when the agent stops citing evidence?"
- "Can I test tool-call behavior, not just final text?"
- "Can I preserve a framework-neutral contract around my agent?"
