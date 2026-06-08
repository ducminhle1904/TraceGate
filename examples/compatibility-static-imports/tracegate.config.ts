import { defineTraceGateConfig } from "@tracegate/cli/config";
import {
  createHarness,
  createMemoryTraceSink,
  defineMatrix,
  defineToolContract,
} from "@tracegate/core";
import { z } from "zod";

const lookupContract = defineToolContract({
  name: "compatLookup",
  riskTier: "read",
  inputSchema: z.object({
    query: z.string(),
  }),
});

export default defineTraceGateConfig({
  matrix: defineMatrix([
    {
      id: "static-import-config",
      prompt: "Load static TraceGate imports from tracegate.config.ts.",
      expect: {
        requiredTools: ["compatLookup"],
        outputKeys: ["answer"],
      },
    },
  ]),
  async runCase() {
    const traceSink = createMemoryTraceSink();
    const harness = createHarness({ traceSink });
    const lookup = harness.wrapTool(lookupContract, async (input) => ({
      answer: `loaded:${input.query}`,
    }));

    const output = await lookup({ query: "static-imports" });
    await harness.finishRun();

    return {
      events: traceSink.events,
      output,
    };
  },
});
