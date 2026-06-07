# TraceGate

TraceGate is a CI-first harness for AI agents with tool-call contracts, replay, and policy gates.

AI agent demos often work until production behavior drifts: the model calls a risky tool, omits required evidence, leaks sensitive data into traces, or changes tool behavior after a prompt or model update. TraceGate turns those behaviors into contracts that developers can test, review, and replay.

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
- Not a replacement for LangSmith, Langfuse, Braintrust, Phoenix, Promptfoo, or gateway guardrails.
- Not tied to Codex, Claude Code, or any specific coding agent.

## Preview Usage

The runtime API is planned for Phase 1 and Phase 2. This sketch shows the intended direction, not an implemented API yet.

```ts
import { createHarness, defineToolContract } from "@tracegate/core";
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
  contracts: [sendEmailContract],
  traceSink: "jsonl",
});

const sendEmail = harness.wrapTool("sendEmail", async (input) => {
  return emailClient.send(input);
});
```

## 60-Second Quickstart

Phase 0 only establishes the repository baseline. Once packages exist, the quickstart will become:

```bash
pnpm add @tracegate/core
pnpm add -D @tracegate/cli
tracegate init
tracegate test
```

For now, verify the repo scaffold:

```bash
pnpm install
pnpm type-check
pnpm lint
pnpm test
```

## Documentation

- [Harness engineering](docs/concepts/harness-engineering.md)
- [Tool-call contracts](docs/concepts/tool-call-contracts.md)
- [Getting started](docs/guides/getting-started.md)
- [CI guide](docs/guides/ci.md)
- [Configuration reference](docs/reference/configuration.md)
- [Observability integrations](docs/integrations/observability.md)
- [Comparisons](docs/comparisons.md)
- [Codex agent skill guide](docs/agent-skills/codex.md)
- [Claude Code agent skill guide](docs/agent-skills/claude-code.md)

## Roadmap

- Phase 0: public positioning, repo scaffold, docs baseline.
- Phase 1: core contracts, schema, policy verdict types, trace rows.
- Phase 2: runtime interceptor and tool wrapper lifecycle.
- Phase 3: eval matrix CLI and CI reporting.
- Phase 4: deterministic replay from traces.
- Phase 5: policy, approval, redaction, and security defaults.
- Phase 6: adapters and observability exports.
- Phase 7: examples, guides, and launch polish.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). TraceGate is documentation-first: new capabilities should include a clear contract, a small example, and the local verification command that proves it works.
