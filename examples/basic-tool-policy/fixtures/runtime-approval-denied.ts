import { defineReplayFixture } from "@tracegate/core";

export default defineReplayFixture({
  version: "1",
  id: "runtime-approval-denied",
  case: {
    id: "runtime-approval-denied",
    prompt: "Runtime gate blocks sendEmail after approval is denied",
    expect: {},
  },
  captured: {
    traceEventCount: 1,
  },
  expect: {
    toolEventSequence: [
      {
        type: "tool.blocked",
        toolName: "sendEmail",
        status: "blocked",
        policyVerdict: "block",
      },
    ],
    toolEventSequenceMode: "ordered-subset",
    traceEventCount: 1,
    traceEventCountMode: "tool-boundary",
  },
  metadata: {
    source: "traces/runtime-approval-denied.jsonl",
    sourceKind: "runtime-gate",
  },
});
