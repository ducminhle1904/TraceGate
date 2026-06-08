# Changelog

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
