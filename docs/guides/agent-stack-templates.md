# Agent Stack Templates

TraceGate ships local-first templates for common JavaScript agent stacks. They do not call
models, require API keys, or replace your app's auth, IAM, business policy, provider guardrails,
or host tool dispatch.

Each template shows the same rollout ladder:

1. `observe`: record tool-boundary summaries and JSONL traces without blocking.
2. `shadow`: compare TraceGate policy with the host runtime verdict without blocking.
3. `enforce` with `validationOnly: true`: block malformed input before side effects.
4. Targeted `enforce`: later, scope by `toolNames` and `riskTiers` when ready.

## Templates

| Stack | Command | Adapter surface |
| --- | --- | --- |
| Plain function tools | `pnpm --filter tracegate-template-plain-functions check` | `@tracegate/adapters/plain-functions` |
| OpenAI Agents SDK | `pnpm --filter tracegate-template-openai-agents check` | `@tracegate/adapters/openai-agents` plus runtime boundary probes |
| LangGraph/LangChain | `pnpm --filter tracegate-template-langgraph-langchain check` | `@tracegate/adapters/langgraph` plus runtime boundary probes |
| Vercel AI SDK | `pnpm --filter tracegate-template-vercel-ai-sdk check` | `@tracegate/adapters/vercel-ai-sdk` |

Run every template:

```bash
pnpm templates:check
```

## What Each Template Proves

Each template contains:

- an existing registry with one read-only tool and one side-effecting tool
- TraceGate contracts derived from registry metadata and Zod schemas
- observe, shadow, validation-only enforce, and selected side-effect enforce rollout examples
- runtime summaries with `mode`, `toolName`, `riskTier`, `finalVerdict`,
  `handlerExecuted`, `sideEffectPrevented`, `enforcementEligible`, and shadow classifications
- a generated `traces/runtime.jsonl`
- a checked-in runtime replay fixture using `traceEventCountMode: "tool-boundary"` and
  `toolEventSequenceMode: "ordered-subset"`

The replay command is the same shape in each template:

```bash
tracegate replay-runtime fixtures/runtime.ts --trace traces/runtime.jsonl
```

To turn a freshly captured runtime trace into a sanitized fixture:

```bash
tracegate runtime record --trace traces/runtime.jsonl --out fixtures/runtime.ts --force
```

Use these templates as starting points for CI probes. Keep real authorization and business
eligibility checks in your host app; use TraceGate to prove agent-facing tool calls honor
contracts, validation, policy diagnostics, redaction, and replay expectations.
