# Codex Agent Skill Guide

This document is guidance for using Codex with TraceGate. It is not an executable integration and TraceGate does not depend on Codex.

## Operating Instructions

- Inspect the host repo before proposing TraceGate changes.
- Identify actual tool execution boundaries before editing code.
- Wrap one tool at a time and keep changes surgical.
- Generate matrix cases from real risk scenarios or failing traces.
- Do not refactor the host agent framework while adding TraceGate.
- Report the verification commands and results.

## Useful Tasks

- Add TraceGate to an existing TypeScript agent app.
- Generate `tracegate.matrix.ts` cases from a dangerous workflow.
- Review a policy rule for over-blocking or under-blocking.
- Inspect a trace and propose a replay fixture.

## Next-Phase TODOs

- Add copyable Codex prompts after the CLI and matrix DSL exist.
- Add examples for OpenAI Agents SDK and LangGraph JS repos.
