import { defineReplayFixture } from "@tracegate/core";

export default defineReplayFixture({
  version: "1",
  id: "replay-refund-policy",
  case: {
    id: "replay-refund-policy",
    prompt: "Find the refund policy and cite the supporting evidence.",
    expect: {
      requiredTools: ["searchKnowledgeBase"],
      orderedToolSequence: ["searchKnowledgeBase"],
      requiredPolicyVerdict: "allow",
      requiredEvidence: ["refund-policy"],
      outputKeys: ["answer", "citations"],
      toolInputIncludes: {
        searchKnowledgeBase: {
          query: "refund policy",
        },
      },
    },
  },
  captured: {
    traceEventCount: 5,
    runId: "run-replay-example",
    runStatus: "succeeded",
  },
  expect: {
    toolSequence: ["searchKnowledgeBase"],
    toolStatuses: {
      searchKnowledgeBase: ["started", "succeeded"],
    },
    policyVerdicts: {
      searchKnowledgeBase: ["allow", "allow"],
    },
    evidence: [
      {
        id: "refund-policy",
        type: "retrieval",
      },
    ],
    runStatus: "succeeded",
    outputKeys: ["answer", "citations"],
    traceEventCount: 5,
  },
  metadata: {
    source: "traces/refund-policy.jsonl",
  },
});
