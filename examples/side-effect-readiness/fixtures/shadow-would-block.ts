import { defineReplayFixture } from "@tracegate/core";

export default defineReplayFixture({
  version: "1",
  id: "shadow-would-block",
  case: {
    id: "shadow-would-block",
    prompt: "Replay shadow mode proving TraceGate would block while host runtime executes.",
    expect: {},
  },
  captured: {
    traceEventCount: 2,
  },
  expect: {
    toolEventSequence: [
      {
        type: "tool.started",
        toolName: "createInvoiceDraft",
        status: "started",
        policyVerdict: "block",
      },
      {
        type: "tool.succeeded",
        toolName: "createInvoiceDraft",
        status: "succeeded",
        policyVerdict: "block",
      },
    ],
    toolEventSequenceMode: "ordered-subset",
    traceEventCount: 2,
    traceEventCountMode: "tool-boundary",
  },
  metadata: {
    source: "traces/shadow-would-block.jsonl",
    sourceKind: "runtime-gate",
  },
});
