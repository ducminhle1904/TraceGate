# CI Guide

TraceGate matrix tests can run in CI after the project adds `tracegate.config.ts`.

## Current Checks

```bash
pnpm install
pnpm type-check
pnpm lint
pnpm test
pnpm examples:check
```

## Agent Checks

```bash
pnpm exec tracegate test --json
pnpm exec tracegate test --junit tracegate-junit.xml
pnpm exec tracegate replay fixtures/blocked-email.ts --junit tracegate-replay.xml
```

## GitHub Actions Example

```yaml
name: tracegate

on:
  pull_request:
  push:
    branches: [main]

jobs:
  matrix:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm type-check
      - run: pnpm test
      - run: pnpm exec tracegate test --junit tracegate-junit.xml
      - run: pnpm exec tracegate replay fixtures/blocked-email.ts --junit tracegate-replay.xml
      - run: pnpm docs:build
```

## CI Goals

- Fail when a forbidden tool is called.
- Fail when required evidence is missing.
- Fail when policy verdicts drift.
- Fail when traces leak configured secrets.
- Fail when replayed tool behavior, evidence, run status, or output shape drifts.

## Artifacts

Write JUnit reports with `--junit <path>` and upload them with your CI provider's artifact
step when you want historical test results. TraceGate does not require hosted storage.
