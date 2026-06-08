# Changelog

## 0.5.1

- Improved `tracegate init` to generate a runnable config, runtime replay fixture, JSONL trace, and redaction check.
- Expanded `tracegate doctor` with package version, module resolution, schema compatibility, and config import preflight diagnostics.
- Updated quickstart docs with CI-ready starter commands and doctor severity guidance.

## 0.5.0

- Added plain function and Vercel AI SDK adapter exports for runtime-gate-wrapped tools.
- Added local-first agent stack templates for plain functions, OpenAI Agents SDK, LangGraph/LangChain, and Vercel AI SDK.
- Added `pnpm templates:check` to build, run, and replay every stack template without model/API credentials.
- Expanded adapter docs with rollout guidance for observe, shadow, validation-only enforcement, and runtime JSONL replay.

## 0.4.0

- Added side-effect safety evidence fields to runtime gate summaries: `handlerSkippedReason`, `sideEffectPrevented`, and `wouldHaveExecutedInShadow`.
- Added `summarizeSideEffectSafety()` for runtime summaries and tool trace records.
- Improved CLI human diagnostics for blocked tool records with handler execution and side-effect prevention details.
- Expanded examples and docs for proving side-effect handlers did not execute after validation, policy, review, or approval-denied gates.

## 0.3.3

- Added runtime replay `toolEventSequence` expectations with exact and ordered-subset matching.
- Made `tracegate fixtures create --runtime-gate` generate tool-boundary, ordered-subset fixtures for production JSONL traces.
- Improved runtime replay docs for approval-denied and runtime-block paths that should not depend on full-run event counts.

## 0.3.2

- Added `enforcement.toolNames` for targeted runtime-gate enforcement by tool name and risk tier while keeping `allowlist` as a trace/gate inclusion filter.
- Added stable runtime-gate summary booleans for production logging: `toolExecuted`, `enforcementApplied`, and `validationOnly`.
- Expanded runtime integration docs with mode mapping, targeted production enforcement, SSE/tool-result error envelopes, and guidance for integrating without replacing auth or business policy.

## 0.3.1

- Made TraceGate tool input schemas structurally `safeParse`-compatible instead of requiring the same `z.ZodType` surface as TraceGate's bundled Zod dependency.
- Relaxed manifest adapter schema-map types so external Zod-compatible registries can pass schema maps without `as unknown as LooseManifestSchemaMap` casts.

## 0.3.0

- Added opt-in `traceRunEvents` support for `createRuntimeGate()` so host runtimes can emit `run.started` and `run.finished` around boundary tool events.
- Added `runId`, `toolCallId`, redacted `context`, and redacted `contractMetadata` to runtime gate summaries.
- Added `createLooseManifestContractAdapter()` for complex tool registries with separate Zod schema maps.
- Added `tracegate replay-runtime` for comparing runtime-gate JSONL traces without requiring `runCase()`.
- Added `tracegate fixtures create --runtime-gate` and replay `traceEventCountMode: "tool-boundary"` for tool-boundary traces.
- Expanded runtime integration docs for shadow comparison aggregation, production-safe sinks, original host risk tiers, and runtime gate replay boundaries.

## 0.2.1

- Added legacy TypeScript declaration compatibility for `@tracegate/core/cjs` projects using `moduleResolution: "node"`.
- Documented the typed CommonJS lazy-load pattern for apps that cannot switch to `node16` or `nodenext` yet.
- Extended release smoke coverage with a temp CommonJS TypeScript consumer that compiles typed `require("@tracegate/core/cjs")`.

## 0.2.0

- Added `createRuntimeGate()` for gradual production rollout with `off`, `observe`, `shadow`, and targeted `enforce` modes.
- Added policy verdict comparison helpers for shadowing existing runtime decisions against TraceGate policy.
- Added `createStructuredLoggerTraceSink()` for forwarding redacted trace events into project-owned production loggers.
- Added `createManifestContractAdapter()` for registries that store tool metadata separately from Zod input schemas.
- Added a CommonJS lazy loader at `@tracegate/core/cjs` for CJS hosts that cannot statically import the ESM package.
- Added runtime integration docs for observe, shadow, low-risk enforcement, approval-denied diagnostics, and error adapters.

## 0.1.1

- Fixed publish metadata so `@tracegate/cli` and `@tracegate/adapters` depend on the npm `@tracegate/core` version instead of `workspace:*`.
- Added a release smoke guard that packs packages, rejects workspace protocol dependencies, and verifies a temp consumer can import core/config and run the CLI.
- Improved CLI human diagnostics for denied approval and replay output assertion failures while keeping JSON/JUnit report shapes stable.
- Expanded docs for approval lifecycle semantics, manifest registry adapters, and evidence timestamp helpers.

## 0.1.0

- Added placeholder-aware secret detection options for redacted trace fixtures.
- Added replay `absentOutputKeys` and `outputValues` assertions for stable path-level output checks.
- Added `createEvidenceRecord()` for standalone evidence records with timestamp auto-fill.
- Added structured policy diagnostics and approval-handler reason support while keeping existing verdict fields stable.
- Improved manifest risk-tier mapping errors and CLI runtime failure diagnostics without changing JSON/JUnit report shapes.

## 0.0.3

- Added generic contract adapter helpers for converting existing tool manifests into TraceGate contracts with custom risk-tier mapping.
- Added replay output-key flexibility with strict exact mode, subset mode, ignored keys, and optional keys.
- Kept evidence timestamp DX by documenting and testing auto-filled timestamps for `recordEvidence()`.
- Improved replay and CLI diagnostics while preserving JSON and JUnit report shapes.
- Added runnable manifest-adapter coverage and expanded examples for validation failures, denied side effects, JSONL traces, and redaction.

## 0.0.2

- Fixed package entrypoint metadata for more reliable static imports from ESM apps, tsx-based TypeScript apps, pnpm workspaces, and nested workspace packages.
- Improved CLI diagnostics for config loading, package resolution, matrix failures, runCase runtime errors, and replay expectation drift.
- Made `harness.recordEvidence()` easier to use by auto-filling timestamps when omitted.
- Added runnable examples for core runtime workflow, JSONL trace sinks, denied side-effect tools, redaction, and static-import compatibility.
- Kept JSON and JUnit report shapes stable for CI consumers.

## 0.0.1

- Initial public package release for `@tracegate/core`, `@tracegate/cli`, and `@tracegate/adapters`.
