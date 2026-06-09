import { defineReplayFixture } from "@tracegate/core";

export default defineReplayFixture({
  version: "1",
  id: "validation-block",
  case: {
    id: "validation-block",
    prompt: "Replay validation blocking before side-effect handler execution.",
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
      },
    ],
    toolEventSequenceMode: "ordered-subset",
    traceEventCount: 1,
    traceEventCountMode: "tool-boundary",
  },
  metadata: {
    source: "traces/validation-block.jsonl",
    sourceKind: "runtime-gate",
  },
});
