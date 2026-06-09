import { defineReplayFixture } from "@tracegate/core";

export default defineReplayFixture({
  version: "1",
  id: "plain-functions-runtime",
  case: {
    id: "plain-functions-runtime",
    prompt: "Replay plain function runtime boundary events",
    expect: {},
  },
  captured: {
    traceEventCount: 5,
  },
  expect: {
    toolEventSequence: [
      {
        type: "tool.succeeded",
        toolName: "lookupCustomer",
        status: "succeeded",
        policyVerdict: "allow",
      },
      {
        type: "tool.succeeded",
        toolName: "draftOrder",
        status: "succeeded",
        policyVerdict: "block",
      },
      { type: "tool.blocked", toolName: "draftOrder", status: "blocked" },
    ],
    toolEventSequenceMode: "ordered-subset",
    evidence: [{ id: "strategy_snapshot:draft_123", type: "tool-output" }],
    traceEventCount: 5,
    traceEventCountMode: "tool-boundary",
  },
  metadata: {
    source: "traces/runtime.jsonl",
    sourceKind: "runtime-gate",
  },
});
