# Configuration Reference

TraceGate CLI configuration starts with `tracegate.config.ts` in the project root.

## Surfaces

- Core harness options.
- Tool contract definitions.
- Policy rules.
- Redaction rules.
- Trace sink configuration.
- CLI matrix configuration through `matrix` and `runCase`.

## CLI Defaults

- Default config file: `tracegate.config.ts`.
- Override config path with `tracegate test --config <path>` or `tracegate doctor --config <path>`.
- TypeScript config files are loaded with `jiti`.
- The project owns `runCase()`; TraceGate does not instantiate an agent framework.

## Defaults To Preserve

- Local-first operation.
- JSONL-friendly traces.
- Redaction by default for known secret-like fields.
- Framework-neutral naming.

## Policy And Redaction

Use `definePolicy()` with `createPolicyEvaluator()` for risk-tier approvals, blocked tiers, environment overrides, tool overrides, and required evidence.

Use `createHarness({ redaction })` or `redactValue(value, options)` for key and string-pattern redaction. Redaction is deterministic and local; it is not a full DLP system.

## Adapter Configuration

Adapters use the same core harness options:

- pass an existing `harness` when your framework owns lifecycle setup
- pass `harnessOptions` when the adapter should create one
- pass trace sinks such as JSONL, memory, or OpenTelemetry

Adapter configuration remains code-owned. TraceGate does not introduce a separate hosted
configuration service.
