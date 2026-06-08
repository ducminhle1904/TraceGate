import { defineTraceGateConfig } from "@tracegate/cli/config";
import { createHarness, defineToolContract } from "@tracegate/core";
import { z } from "zod";

const contract = defineToolContract({
  name: "nestedTsxImport",
  riskTier: "read",
  inputSchema: z.object({ value: z.string() }),
});
const harness = createHarness();
const config = defineTraceGateConfig({
  matrix: [{ id: "nested-tsx", prompt: "Nested tsx import", expect: {} }],
  async runCase() {
    return { events: [] };
  },
});

if (contract.name !== "nestedTsxImport" || config.matrix.length !== 1) {
  throw new Error("TraceGate nested tsx compatibility failed.");
}

async function main() {
  await harness.finishRun();
  console.log("nested tsx static imports ok");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
