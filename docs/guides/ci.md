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
tracegate test --json
tracegate test --junit tracegate-junit.xml
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
      - run: pnpm tracegate test --junit tracegate-junit.xml
```

## CI Goals

- Fail when a forbidden tool is called.
- Fail when required evidence is missing.
- Fail when policy verdicts drift.
- Fail when traces leak configured secrets.

## Next-Phase TODOs

- Show how production traces become regression cases after Phase 4.
- Add hosted CI artifact examples.
