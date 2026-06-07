# CI Guide

TraceGate matrix tests can run in CI after the project adds `tracegate.config.ts`.

## Current Checks

```bash
pnpm install
pnpm type-check
pnpm lint
pnpm test
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
      - run: pnpm exec tracegate test --junit tracegate-junit.xml
      - run: pnpm exec tracegate replay fixtures/blocked-email.ts --junit tracegate-replay.xml
```

## CI Goals

- Fail when a forbidden tool is called.
- Fail when required evidence is missing.
- Fail when policy verdicts drift.
- Fail when traces leak configured secrets.
- Fail when replayed tool behavior, evidence, run status, or output shape drifts.

## Next-Phase TODOs

- Add hosted CI artifact examples.
