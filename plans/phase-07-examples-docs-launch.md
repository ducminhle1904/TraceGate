# Phase 07: Examples, Docs, And Public Launch

## Goal

Make TraceGate understandable and attractive to developers evaluating the project for the first time.

## Examples

Build at least three examples:

- `examples/basic-tool-policy`: block a dangerous tool call
- `examples/replay-failure`: generate a fixture from a trace and replay it
- `examples/langgraph-js`: wrap a LangGraph JS agent
- `examples/openai-agents`: wrap an OpenAI Agents SDK app

## Docs

Create:

- `docs/concepts/harness-engineering.md`
- `docs/concepts/tool-call-contracts.md`
- `docs/concepts/replay.md`
- `docs/concepts/side-effect-boundaries.md`
- `docs/guides/getting-started.md`
- `docs/guides/ci.md`
- `docs/guides/redaction.md`
- `docs/guides/policy-cookbook.md`
- `docs/guides/framework-adapters.md`
- `docs/reference/core-contracts.md`
- `docs/reference/matrix-file.md`
- `docs/reference/runtime-semantics.md`
- `docs/comparisons.md`

## Agent Skills

Create agent-facing docs/templates:

- `docs/agent-skills/codex.md`
- `docs/agent-skills/claude-code.md`
- `docs/agent-skills/generate-matrix-cases.md`
- `docs/agent-skills/review-policy.md`

These should be concise, copyable operating instructions for coding agents. They should cover how to inspect a host repo, wrap tools surgically, generate tests from traces, and avoid broad refactors.

## Launch README Checklist

- install command
- 60-second quickstart
- concrete failing test example
- before/after trace output
- compatibility table
- comparison table for observability/eval/guardrail tools
- roadmap
- contribution guide
- agent-skills section for coding-agent users

## Public Messaging

Use this positioning:

"TraceGate is a CI-first harness for AI agents. It turns tool calls, evidence, replay, and policy into versioned contracts."

Avoid this positioning:

- "Build AI agents visually"
- "The best agent framework"
- "All-in-one AI observability"
- "Autonomous workflow builder"

## Verification

- fresh clone quickstart works
- examples run without hidden services
- README does not overclaim
- docs explain non-goals clearly
- agent-skill docs can be followed in a fresh example repo
- comparison docs explain where TraceGate complements existing tools
