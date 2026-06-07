# @tracegate/core

Core contracts, schemas, and policy primitives for TraceGate.

Phase 1 implemented the framework-neutral contract layer: tool contracts, policy verdicts, trace rows, evidence records, matrix cases, and small redaction helpers.

Phase 2 adds the runtime interceptor layer: `createHarness()`, `wrapTool()`, run lifecycle methods, evidence recording, approval handling, and memory/JSONL trace sinks.
