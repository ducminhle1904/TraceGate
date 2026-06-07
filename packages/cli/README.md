# @tracegate/cli

Command line interface for running TraceGate matrix tests.

## Commands

```bash
tracegate init
tracegate test
tracegate test --case blocks-email
tracegate test --policy
tracegate test --json
tracegate test --junit tracegate-junit.xml
tracegate doctor
```

TraceGate loads `tracegate.config.ts` by default. The project supplies `runCase()`; the CLI does not create or run an agent by itself.
