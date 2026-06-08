# Changelog

## 0.0.2

- Fixed package entrypoint metadata for more reliable static imports from ESM apps, tsx-based TypeScript apps, pnpm workspaces, and nested workspace packages.
- Improved CLI diagnostics for config loading, package resolution, matrix failures, runCase runtime errors, and replay expectation drift.
- Made `harness.recordEvidence()` easier to use by auto-filling timestamps when omitted.
- Added runnable examples for core runtime workflow, JSONL trace sinks, denied side-effect tools, redaction, and static-import compatibility.
- Kept JSON and JUnit report shapes stable for CI consumers.

## 0.0.1

- Initial public package release for `@tracegate/core`, `@tracegate/cli`, and `@tracegate/adapters`.
