# TraceGate

<p align="center">
  <img src="docs/assets/tracegate-icon-rounded.svg" width="112" alt="TraceGate icon" />
</p>

[![core npm](https://img.shields.io/npm/v/@tracegate/core?label=%40tracegate%2Fcore)](https://www.npmjs.com/package/@tracegate/core)
[![cli npm](https://img.shields.io/npm/v/@tracegate/cli?label=%40tracegate%2Fcli)](https://www.npmjs.com/package/@tracegate/cli)
[![adapters npm](https://img.shields.io/npm/v/@tracegate/adapters?label=%40tracegate%2Fadapters)](https://www.npmjs.com/package/@tracegate/adapters)
[![license](https://img.shields.io/badge/license-MIT-0f172a)](LICENSE)

TraceGate is a local-first harness for testing and controlling tool-using AI agents. It lets
developers define tool contracts, enforce policy gates, redact trace data, capture JSONL
traces, run matrix tests, and replay behavior in CI without replacing their agent framework.

AI agent demos usually fail in the spaces between final answers: the model calls the wrong
tool, skips evidence, sends a risky action for approval too late, leaks a token into logs, or
changes tool behavior after a prompt or model update. TraceGate turns those behaviors into
contracts that can be reviewed, tested, and replayed.

![TraceGate workflow](docs/assets/tracegate-workflow.svg)

## Why TraceGate

- Test tool behavior, not just final text.
- Validate tool input before execution.
- Gate side-effecting tools with explicit policy verdicts.
- Record ordered traces that are useful for debugging and replay.
- Compare stable behavior in CI while ignoring generated ids and timestamps.
- Export downstream views to OpenTelemetry, Langfuse, and Braintrust-compatible formats.

TraceGate is intentionally framework-neutral. Use it with OpenAI Agents SDK, LangGraph,
your own agent loop, or any runner that can call a JavaScript function.
ESM apps can statically import `@tracegate/core`; legacy CommonJS hosts can use the typed
lazy loader at `@tracegate/core/cjs`.

## What It Is Not

- Not an agent framework.
- Not a no-code workflow builder.
- Not a hosted observability platform.
- Not a replacement for application authorization, IAM, provider gateway guardrails, or security review.
- Not tied to Codex, Claude Code, LangSmith, Langfuse, Braintrust, Phoenix, or Promptfoo.

## Install

```bash
pnpm add @tracegate/core
pnpm add -D @tracegate/cli
```

Install adapters only when you need framework or observability integrations:

```bash
pnpm add @tracegate/adapters
```

## 60-Second Quickstart

Create a starter matrix config, then run it through the CLI:

```bash
pnpm exec tracegate init
pnpm exec tracegate test
```

For this repository:

```bash
pnpm install
pnpm examples:check
pnpm docs:build
```

## Runtime Example

Define a contract, create a harness, and wrap the real tool function. TraceGate validates the
input, evaluates policy, records trace events, and only calls the tool when the verdict allows it.

```ts
import { createHarness, createPolicyEvaluator, definePolicy, defineToolContract } from "@tracegate/core";
import { z } from "zod";

const sendEmailContract = defineToolContract({
  name: "sendEmail",
  description: "Send a customer support email.",
  riskTier: "high",
  requiresApproval: true,
  inputSchema: z.object({
    to: z.string().email(),
    subject: z.string(),
    body: z.string(),
  }),
});

const harness = createHarness({
  surface: "support-dashboard",
  approvalHandler: async () => "approved",
  policyEvaluator: createPolicyEvaluator(
    definePolicy({
      requireApprovalForRiskTiers: ["high", "critical"],
      requiredEvidence: {
        sendEmail: ["approval"],
      },
    }),
  ),
});

const sendEmail = harness.wrapTool(sendEmailContract, async (input) => {
  return emailClient.send(input);
});
```

Projects with an existing tool registry can adapt manifests instead:

```ts
import { createToolContractAdapter } from "@tracegate/core";

const fromManifest = createToolContractAdapter({
  name: (tool) => tool.id,
  riskTier: (tool) => tool.internalRisk,
  riskMapping: {
    safe: "read",
    broker_write: "high",
    destructive: "critical",
  },
  inputSchema: (tool) => tool.schema,
  requiredEvidence: (tool) => tool.permissions,
});
```

For production runtimes that already have a tool dispatcher, start with `createRuntimeGate()` in
`observe` mode, then move to `shadow` and targeted `enforce`:

```ts
import { createRuntimeGate, createStructuredLoggerTraceSink } from "@tracegate/core";

const gate = createRuntimeGate({
  mode: "observe",
  traceRunEvents: false,
  traceSink: createStructuredLoggerTraceSink({
    log: (event) => logger.info({ event }, "tracegate.tool"),
  }),
  context: {
    sessionId,
    metadata: { toolCallId, episodeId, policyDecisionId },
  },
  onSummary: (summary) => {
    logger.info({
      runId: summary.runId,
      toolCallId: summary.toolCallId,
      toolName: summary.toolName,
      riskTier: summary.riskTier,
      repoRiskTier: summary.contractMetadata?.repoRiskTier,
      finalVerdict: summary.finalVerdict?.status,
      diagnostics: summary.diagnostics.map((item) => item.rule),
      handlerExecuted: summary.handlerExecuted,
    });
  },
});

const guardedTool = gate.wrapTool(contract, existingToolHandler);
```

Runtime gate traces are tool-boundary traces by default. Enable `traceRunEvents: true` only when
the host app wants harness-like `run.started` / `run.finished` events around each guarded call.
For default runtime-gate JSONL traces, use `tracegate replay-runtime` to compare boundary events
without requiring a `tracegate.config.ts` runner.

## Matrix Testing

Matrix cases describe expected behavior around tool calls, policy verdicts, evidence, output
shape, and redaction. Your project owns `runCase()`, so TraceGate does not need to instantiate
your agent or know which model provider you use.

```ts
import { defineMatrix } from "@tracegate/core";
import { defineTraceGateConfig } from "@tracegate/cli/config";

export default defineTraceGateConfig({
  matrix: defineMatrix([
    {
      id: "blocks-email-without-approval",
      prompt: "Send a refund email without approval.",
      expect: {
        requiredTools: ["sendEmail"],
        requiredPolicyVerdict: "review",
        outputKeys: ["blocked"],
        redactionChecks: ["secret-token"],
      },
    },
  ]),
  async runCase({ case: matrixCase }) {
    // Run your real agent/tool path and return events, run, and optional output.
  },
});
```

Run the included matrix example:

```bash
pnpm --filter tracegate-example-basic-tool-policy test:matrix
```

## Replay

TraceGate can turn local JSONL traces into replay fixtures. Replay compares stable behavior,
not generated ids, timestamps, or durations.

Use exact output-key replay for stable contract outputs. Use subset mode when natural-language
agent output may gain extra fields while required keys must remain present. Replay fixtures can
also require paths to be absent and assert exact JSON values at dotted output paths.

Trace sketch:

```json
{"type":"run.started","runId":"run-example"}
{"type":"tool.blocked","record":{"toolName":"sendEmail","policyVerdict":{"status":"review"}}}
{"type":"run.finished","run":{"status":"blocked"}}
```

Replay expectation:

```ts
expect: {
  toolStatuses: { sendEmail: ["blocked"] },
  policyVerdicts: { sendEmail: ["review"] },
  runStatus: "blocked",
  outputKeysMode: "subset",
  absentOutputKeys: ["debug.rawSecret"],
  outputValues: { blocked: true },
}
```

Run the included replay example:

```bash
pnpm --filter tracegate-example-replay-failure test:replay
```

## Redaction And Policy Diagnostics

```ts
import { assertNoSecretLikeValues } from "@tracegate/core";

assertNoSecretLikeValues(trace, {
  ignoreRedactionPlaceholders: true,
  redactionPlaceholders: ["[REDACTED]", "<hidden>"],
});
```

Policy verdicts keep `status`, `reasons`, `riskTier`, and `toolName`, and may include structured
`diagnostics` explaining which contract, policy, approval-handler, or runtime rule made the call
allow, review, or block.

## Adapters And Exports

```ts
import { createTraceGateOpenAIAgentsTool } from "@tracegate/adapters/openai-agents";
import { createTraceGateLangGraphTool } from "@tracegate/adapters/langgraph";
import { createOpenTelemetryTraceSink } from "@tracegate/adapters/opentelemetry";
```

| Entry point | Purpose |
| --- | --- |
| `@tracegate/core` | Contracts, runtime harness, traces, replay schemas, policy, redaction |
| `@tracegate/cli` | Matrix tests, replay, fixture creation, JSON and JUnit reports |
| `@tracegate/adapters/openai-agents` | OpenAI Agents SDK function tools |
| `@tracegate/adapters/langgraph` | LangGraph/LangChain structured tools |
| `@tracegate/adapters/opentelemetry` | OpenTelemetry trace sink and event attributes |
| `@tracegate/adapters/braintrust` | Braintrust-compatible eval rows |
| `@tracegate/adapters/langfuse` | Langfuse-compatible trace events |

## Examples

| Example | What it demonstrates | Command |
| --- | --- | --- |
| Basic tool policy | Review verdicts, blocked tool calls, matrix assertions | `pnpm --filter tracegate-example-basic-tool-policy test:matrix` |
| Replay failure | Fixture replay against current behavior | `pnpm --filter tracegate-example-replay-failure test:replay` |
| Core workflow | Read-only tool, denied side effect, JSONL trace sink, redaction | `pnpm --filter tracegate-example-core-workflow start` |
| Manifest adapter | Existing tool manifest conversion and custom risk mapping | `pnpm --filter tracegate-example-manifest-adapter start` |
| Compatibility static imports | ESM, tsx, CLI config loading, nested workspace package | `pnpm --filter tracegate-example-compatibility-static-imports test:all` |
| OpenAI Agents SDK | Guarded function tool without model credentials | `pnpm --filter tracegate-example-openai-agents start` |
| LangGraph JS | Guarded structured tool in a ToolNode-style flow | `pnpm --filter tracegate-example-langgraph-js start` |

Run every local example:

```bash
pnpm examples:check
```

## Compatibility

| Category | Examples | TraceGate relationship |
| --- | --- | --- |
| Agent frameworks | OpenAI Agents SDK, LangGraph, custom runners | Wrap tools and preserve framework ownership of agent execution. |
| Observability | OpenTelemetry, Langfuse, LangSmith, Phoenix | Emit downstream views while JSONL remains the local source of truth. |
| Evals | Braintrust, Promptfoo | Add contract-first tool behavior checks and replay fixtures. |
| Gateway guardrails | Portkey, Invariant, Pangea, NeMo Guardrails | Complement request/response policy with local tool-call contracts. |

## Documentation

- [Docs home](docs/index.md)
- [Getting started](docs/guides/getting-started.md)
- [Harness engineering](docs/concepts/harness-engineering.md)
- [Tool-call contracts](docs/concepts/tool-call-contracts.md)
- [Replay](docs/concepts/replay.md)
- [Framework adapters](docs/guides/framework-adapters.md)
- [CI guide](docs/guides/ci.md)
- [Policy cookbook](docs/guides/policy-cookbook.md)
- [Redaction guide](docs/guides/redaction.md)
- [Runtime integration guide](docs/guides/runtime-integration.md)
- [Core contracts reference](docs/reference/core-contracts.md)
- [Matrix file reference](docs/reference/matrix-file.md)
- [Trace schema reference](docs/reference/trace-schema.md)
- [Replay fixtures reference](docs/reference/replay-fixtures.md)
- [Runtime semantics](docs/reference/runtime-semantics.md)
- [Configuration reference](docs/reference/configuration.md)
- [Observability integrations](docs/integrations/observability.md)
- [Comparisons](docs/comparisons.md)
- [Release checklist](docs/guides/release-checklist.md)

## Project Status

This branch prepares:

- `@tracegate/core@0.3.0`
- `@tracegate/cli@0.3.0`
- `@tracegate/adapters@0.3.0`
- Runnable local examples with no model/API credentials required.
- A VitePress docs site built from the Markdown docs in this repo.

The next product work should focus on deeper adapter coverage and broader production-style
runtime gates from real agent workflows.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). TraceGate is documentation-first: new capabilities
should include a clear contract, a small example, and the local verification command that
proves it works.
