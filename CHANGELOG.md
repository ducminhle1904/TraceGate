# Changelog

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
