import { defineTraceGateConfig } from "@tracegate/cli/config";
import {
  createHarness,
  createMemoryTraceSink,
  defineMatrix,
  defineToolContract,
} from "@tracegate/core";
import { z } from "zod";

const lookupContract = defineToolContract({
  name: "nestedLookup",
  riskTier: "read",
  inputSchema: z.object({
    query: z.string(),
  }),
});

export default defineTraceGateConfig({
  matrix: defineMatrix([
    {
      id: "nested-static-import-config",
      prompt: "Load TraceGate static imports from a nested workspace package.",
      expect: {
        requiredTools: ["nestedLookup"],
        outputKeys: ["answer"],
      },
    },
  ]),
  async runCase() {
    const traceSink = createMemoryTraceSink();
    const harness = createHarness({ traceSink });
    const lookup = harness.wrapTool(lookupContract, async (input) => ({
      answer: `nested:${input.query}`,
    }));

    const output = await lookup({ query: "workspace" });
    await harness.finishRun();

    return {
      events: traceSink.events,
      output,
    };
  },
});
