import { defineTraceGateConfig } from "@tracegate/cli/config";
import { createHarness, defineMatrix, defineToolContract } from "@tracegate/core";
import { z } from "zod";

const contract = defineToolContract({
  name: "esmStaticImport",
  riskTier: "read",
  inputSchema: z.object({ value: z.string() }),
});
const harness = createHarness();
const matrix = defineMatrix([{ id: "esm", prompt: "ESM import", expect: {} }]);
const config = defineTraceGateConfig({
  matrix,
  async runCase() {
    return { events: [] };
  },
});

if (contract.name !== "esmStaticImport" || config.matrix.length !== 1) {
  throw new Error("TraceGate ESM static import compatibility failed.");
}

await harness.finishRun();
console.log("esm static imports ok");
