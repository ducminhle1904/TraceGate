import { defineReplayFixture } from "@tracegate/core";

export default defineReplayFixture({
  version: "1",
  id: "policy-block",
  case: {
    id: "policy-block",
    prompt: "Replay policy blocking before side-effect handler execution.",
    expect: {},
  },
  captured: {
    traceEventCount: 1,
  },
  expect: {
    toolEventSequence: [
      {
        type: "tool.blocked",
        toolName: "saveStrategyDraft",
        status: "blocked",
        policyVerdict: "block",
      },
    ],
    toolEventSequenceMode: "ordered-subset",
    traceEventCount: 1,
    traceEventCountMode: "tool-boundary",
  },
  metadata: {
    source: "traces/policy-block.jsonl",
    sourceKind: "runtime-gate",
  },
});
