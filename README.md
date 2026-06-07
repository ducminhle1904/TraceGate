# TraceGate

TraceGate is a CI-first harness for tool-using AI agents. It gives developers contracts,
policy gates, redaction, trace capture, matrix tests, replay fixtures, framework adapters,
and observability exports without replacing their agent framework.

AI agent demos often work until production behavior drifts: the model calls a risky tool,
omits required evidence, leaks sensitive data into traces, or changes tool behavior after a
prompt or model update. TraceGate turns those behaviors into contracts that developers can
test, review, and replay.

## What TraceGate Does

- Defines contracts for tools an agent can call.
- Validates tool inputs before execution.
- Applies side-effect policy gates for risky actions.
- Records JSONL-friendly traces for debugging and replay.
- Tests tool-call behavior in CI, not just final text.
- Preserves evidence and provenance requirements.
- Exports to existing observability and eval tools instead of replacing them.

## What TraceGate Is Not

- Not an agent framework.
- Not a no-code workflow builder.
- Not a replacement for application authorization, IAM, provider gateway guardrails, or security review.
- Not an observability platform clone or replacement for LangSmith, Langfuse, Braintrust, Phoenix, Promptfoo, or gateway guardrails.
- Not tied to Codex, Claude Code, or any specific coding agent.

## 60-Second Quickstart

```bash
pnpm add @tracegate/core @tracegate/adapters
pnpm add -D @tracegate/cli
tracegate init
tracegate test
```

For this repository:

```bash
pnpm install
pnpm examples:check
pnpm docs:build
```

## Runtime Usage

```ts
import { createHarness, createPolicyEvaluator, definePolicy, defineToolContract } from "@tracegate/core";
import { z } from "zod";

const sendEmailContract = defineToolContract({
  name: "sendEmail",
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

## Concrete Failing Test

A matrix case can fail CI when a risky tool is attempted without approval:

```ts
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
  async runCase() {
    // Your project owns this function and runs its existing agent/tool path.
  },
});
```

Run the included example:

```bash
pnpm --filter tracegate-example-basic-tool-policy test:matrix
```

## Trace Sketch

Before replay, a local JSONL trace records ordered events:

```json
{"type":"run.started","runId":"run-example"}
{"type":"tool.blocked","record":{"toolName":"sendEmail","policyVerdict":{"status":"review"}}}
{"type":"run.finished","run":{"status":"blocked"}}
```

After fixture creation, replay compares stable behavior instead of timestamps or generated ids:

```ts
expect: {
  toolStatuses: { sendEmail: ["blocked"] },
  policyVerdicts: { sendEmail: ["review"] },
  runStatus: "blocked",
}
```

## Adapters And Exports

```ts
import { createTraceGateOpenAIAgentsTool } from "@tracegate/adapters/openai-agents";
import { createTraceGateLangGraphTool } from "@tracegate/adapters/langgraph";
import { createOpenTelemetryTraceSink } from "@tracegate/adapters/opentelemetry";
```

Package entrypoints:

| Entry point | Purpose |
| --- | --- |
| `@tracegate/core` | contracts, runtime harness, traces, replay schemas, policy, redaction |
| `@tracegate/cli` | matrix tests, replay, fixture creation, CI reports |
| `@tracegate/adapters/openai-agents` | OpenAI Agents SDK function tools |
| `@tracegate/adapters/langgraph` | LangGraph/LangChain structured tools |
| `@tracegate/adapters/opentelemetry` | OpenTelemetry trace sink |
| `@tracegate/adapters/braintrust` | Braintrust-compatible eval rows |
| `@tracegate/adapters/langfuse` | Langfuse-compatible trace events |

## Examples

| Example | Command |
| --- | --- |
| Basic tool policy | `pnpm --filter tracegate-example-basic-tool-policy test:matrix` |
| Replay failure | `pnpm --filter tracegate-example-replay-failure test:replay` |
| OpenAI Agents SDK | `pnpm --filter tracegate-example-openai-agents start` |
| LangGraph JS | `pnpm --filter tracegate-example-langgraph-js start` |

## Compatibility

| Category | Examples | TraceGate relationship |
| --- | --- | --- |
| Agent frameworks | OpenAI Agents SDK, LangGraph, Mastra | Wrap tool execution without replacing the framework. |
| Observability | LangSmith, Langfuse, Phoenix, Helicone | Export traces and policy events; do not replace dashboards. |
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
- [Core contracts reference](docs/reference/core-contracts.md)
- [Matrix file reference](docs/reference/matrix-file.md)
- [Trace schema reference](docs/reference/trace-schema.md)
- [Replay fixtures reference](docs/reference/replay-fixtures.md)
- [Runtime semantics](docs/reference/runtime-semantics.md)
- [Configuration reference](docs/reference/configuration.md)
- [Observability integrations](docs/integrations/observability.md)
- [Comparisons](docs/comparisons.md)
- [Release checklist](docs/guides/release-checklist.md)

## Roadmap

- Phase 0: public positioning, repo scaffold, docs baseline.
- Phase 1: core contracts, schema, policy verdict types, trace rows.
- Phase 2: runtime interceptor and tool wrapper lifecycle.
- Phase 3: eval matrix CLI and CI reporting.
- Phase 4: deterministic replay from traces.
- Phase 5: policy, approval, redaction, and security defaults.
- Phase 6: adapters and observability exports.
- Phase 7: examples, guides, docs site, and launch polish.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). TraceGate is documentation-first: new capabilities
should include a clear contract, a small example, and the local verification command that
proves it works.
