# OpenAI Agents SDK Example

## Purpose

This example creates a real OpenAI Agents SDK function tool with
`createTraceGateOpenAIAgentsTool()` and runs the local tool path without calling a model.

## Run

```bash
pnpm --filter tracegate-example-openai-agents start
```

## Expected Output

The command prints JSON with the tool result, the TraceGate run id, and ordered trace event
names.

## Demonstrates

- OpenAI Agents SDK function-tool creation.
- `harness.wrapTool()` execution through the adapter.
- Local trace events without model or API credentials.
