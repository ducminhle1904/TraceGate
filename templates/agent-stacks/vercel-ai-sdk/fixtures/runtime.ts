import { defineReplayFixture } from "@tracegate/core";

export default defineReplayFixture({
  version: "1",
  id: "vercel-ai-sdk-runtime",
  case: {
    id: "vercel-ai-sdk-runtime",
    prompt: "Replay Vercel AI SDK runtime boundary events",
    expect: {},
  },
  captured: { traceEventCount: 5 },
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
    traceEventCount: 5,
    traceEventCountMode: "tool-boundary",
  },
  metadata: { source: "traces/runtime.jsonl", sourceKind: "runtime-gate" },
});
