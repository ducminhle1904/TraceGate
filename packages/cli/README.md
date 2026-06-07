# @tracegate/cli

Command line interface for running TraceGate matrix tests.

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
tracegate replay fixtures/example.ts
tracegate replay fixtures/example.ts --json
tracegate replay fixtures/example.ts --junit replay-junit.xml
tracegate replay --update fixtures/example.ts
tracegate doctor
```

TraceGate loads `tracegate.config.ts` by default. The project supplies `runCase()`; the CLI does not create or run an agent by itself.
