import { defineReplayFixture } from "@tracegate/core";

export default defineReplayFixture({
  version: "1",
  id: "approval-denied",
  case: {
    id: "approval-denied",
    prompt: "Replay approval denial before side-effect handler execution.",
    expect: {},
  },
  captured: {
    traceEventCount: 1,
  },
  expect: {
    toolEventSequence: [
      {
        type: "tool.blocked",
        toolName: "createInvoiceDraft",
        status: "blocked",
        policyVerdict: "block",
      },
    ],
    toolEventSequenceMode: "ordered-subset",
    traceEventCount: 1,
    traceEventCountMode: "tool-boundary",
  },
  metadata: {
    source: "traces/approval-denied.jsonl",
    sourceKind: "runtime-gate",
  },
});
