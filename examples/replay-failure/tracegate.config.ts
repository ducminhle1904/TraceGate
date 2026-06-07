import { defineTraceGateConfig } from "@tracegate/cli/config";
import {
  createHarness,
  createMemoryTraceSink,
  defineMatrix,
  defineToolContract,
} from "@tracegate/core";
import { z } from "zod";

const searchKnowledgeBaseContract = defineToolContract({
  name: "searchKnowledgeBase",
  description: "Search the internal support knowledge base.",
  riskTier: "read",
  inputSchema: z.object({
    query: z.string().min(1),
  }),
});

export default defineTraceGateConfig({
  matrix: defineMatrix([
    {
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
  ]),
  async runCase() {
    const traceSink = createMemoryTraceSink();
    const harness = createHarness({ traceSink });
    const searchKnowledgeBase = harness.wrapTool(
      searchKnowledgeBaseContract,
      async (input, context) => {
        await context.recordEvidence({
          id: "refund-policy",
          type: "retrieval",
          timestamp: new Date().toISOString(),
          source: "support-kb",
          content: {
            query: input.query,
            title: "Refund policy",
          },
        });

        return {
          title: "Refund policy",
          summary: "Refunds require a support approval record before customer notification.",
        };
      },
    );

    const result = await searchKnowledgeBase({ query: "refund policy" });
    const run = await harness.finishRun("succeeded");

    return {
      events: traceSink.events,
      run,
      output: {
        answer: result.summary,
        citations: ["refund-policy"],
      },
    };
  },
});
