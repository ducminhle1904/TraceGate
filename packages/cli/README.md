# @tracegate/cli

Command line interface for running TraceGate matrix tests.

## Install

```bash
pnpm add -D @tracegate/cli
```

## Commands

```bash
tracegate init
tracegate test
tracegate test --case blocks-email
tracegate test --policy
tracegate test --concurrency 2
tracegate test --json
tracegate test --junit tracegate-junit.xml
tracegate fixtures create trace.jsonl --out fixtures/example.ts
tracegate fixtures create runtime-gate.jsonl --runtime-gate --out fixtures/runtime-gate.ts
tracegate replay fixtures/example.ts
tracegate replay fixtures/example.ts --json
tracegate replay fixtures/example.ts --junit replay-junit.xml
tracegate replay --update fixtures/example.ts
tracegate replay-runtime fixtures/runtime-gate.ts --trace traces/current-runtime-gate.jsonl
tracegate doctor
```

TraceGate loads `tracegate.config.ts` by default. The project supplies `runCase()`; the CLI does not create or run an agent by itself.

## CI

```bash
tracegate test --json
tracegate test --junit tracegate-junit.xml
tracegate replay fixtures/example.ts --junit tracegate-replay.xml
tracegate replay-runtime fixtures/runtime-gate.ts --trace traces/current-runtime-gate.jsonl --junit tracegate-runtime-replay.xml
```

The JSON and JUnit outputs are intended for local automation and CI artifacts.
