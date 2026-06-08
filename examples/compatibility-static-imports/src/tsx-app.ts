import { defineTraceGateConfig } from "@tracegate/cli/config";
import { createHarness, defineMatrix, defineToolContract } from "@tracegate/core";
import { z } from "zod";

const contract = defineToolContract({
  name: "tsxStaticImport",
  riskTier: "read",
  inputSchema: z.object({ value: z.string() }),
});
const harness = createHarness();
const matrix = defineMatrix([{ id: "tsx", prompt: "TSX import", expect: {} }]);
const config = defineTraceGateConfig({
  matrix,
  async runCase() {
    return { events: [] };
  },
});

if (contract.name !== "tsxStaticImport" || config.matrix.length !== 1) {
  throw new Error("TraceGate tsx static import compatibility failed.");
}

await harness.finishRun();
console.log("tsx static imports ok");
