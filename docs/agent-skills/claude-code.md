# Claude Code Agent Skill Guide

This document is guidance for using Claude Code with TraceGate. It is not an executable integration and TraceGate does not depend on Claude Code.

## Operating Instructions

- Treat TraceGate as a harness around existing tools, not a replacement agent framework.
- Read the host repo's tool definitions, tests, and docs before changing code.
- Prefer a small wrapped-tool change plus a matrix case over a broad rewrite.
- Preserve existing application behavior unless a policy block is the explicit goal.
- Keep secrets and raw production payloads out of prompts, docs, and traces.

## Useful Tasks

- Draft policy rules from a support, finance, file edit, or deploy workflow.
- Convert a known incident trace into a replay scenario.
- Check whether a matrix case validates tool behavior rather than final prose only.

## Next-Phase TODOs

- Add Claude Code prompt templates.
- Add safety checklist examples for file, shell, browser, and deploy tools.
