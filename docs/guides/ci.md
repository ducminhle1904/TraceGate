# CI Guide

TraceGate should make agent behavior testable in CI. Phase 0 only provides repo verification commands.

## Current Checks

```bash
pnpm install
pnpm type-check
pnpm lint
pnpm test
```

## Planned Agent Checks

```bash
tracegate test --json
tracegate test --junit
tracegate replay traces/refund-failure.jsonl
```

## CI Goals

- Fail when a forbidden tool is called.
- Fail when required evidence is missing.
- Fail when policy verdicts drift.
- Fail when traces leak configured secrets.

## Next-Phase TODOs

- Add a GitHub Actions workflow example.
- Document report schemas for JSON and JUnit output.
- Show how production traces become regression cases.
