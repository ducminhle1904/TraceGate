# LangGraph JS Example

## Purpose

This example creates a LangGraph/LangChain-compatible structured tool with
`createTraceGateLangGraphTool()` and invokes the local tool path without calling a model.

## Run

```bash
pnpm --filter tracegate-example-langgraph-js start
```

## Expected Output

The command prints JSON with the tool result, the TraceGate run id, and ordered trace event
names.

## Demonstrates

- LangGraph/LangChain structured-tool creation.
- `harness.wrapTool()` execution through the adapter.
- Local trace events without model or API credentials.
