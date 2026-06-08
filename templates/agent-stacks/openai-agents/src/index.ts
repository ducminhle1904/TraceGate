import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createTraceGateOpenAIAgentsTool } from "@tracegate/adapters/openai-agents";
import { createTraceGateFunctionRegistry } from "@tracegate/adapters/plain-functions";
import {
  createHarness,
  createJsonlFileTraceSink,
  defineToolContractFromManifest,
  type PolicyEvaluator,
  type RuntimeGateSummary,
} from "@tracegate/core";
import { z } from "zod";

const here = dirname(fileURLToPath(import.meta.url));
const tracePath = join(here, "..", "traces", "runtime.jsonl");
await rm(tracePath, { force: true });
await mkdir(dirname(tracePath), { recursive: true });

const registry = {
  lookupCustomer: {
    description: "Read customer profile.",
    inputSchema: z.object({ customerId: z.string().min(1) }),
    riskTier: "read",
    execute: async (input: { customerId: string }) => ({
      customerId: input.customerId,
      tier: "pro",
    }),
  },
  draftOrder: {
    description: "Draft an order before broker submission.",
    inputSchema: z.object({ symbol: z.string().min(1), quantity: z.number().positive() }),
    riskTier: "medium",
    requiresApproval: true,
    execute: async (input: { symbol: string; quantity: number }) => ({
      orderId: `draft_${input.symbol}_${input.quantity}`,
    }),
  },
};
type LookupManifest = typeof registry.lookupCustomer;

const lookupContract = defineToolContractFromManifest(registry.lookupCustomer, {
  name: "lookupCustomer",
  riskTier: (manifest: LookupManifest) => manifest.riskTier,
  inputSchema: (manifest: LookupManifest) => manifest.inputSchema,
  description: (manifest: LookupManifest) => manifest.description,
});
const openAiTool = createTraceGateOpenAIAgentsTool(
  lookupContract,
  registry.lookupCustomer.execute,
  { harness: createHarness({ surface: "openai-agents-template" }) },
);
const sdkOutput = await openAiTool.invoke({} as never, JSON.stringify({ customerId: "cust_123" }));

const summaries: RuntimeGateSummary[] = [];
const traceSink = createJsonlFileTraceSink(tracePath);
const traceGateBlocksWrites: PolicyEvaluator = ({ contract }) => ({
  status: contract.riskTier === "medium" ? "block" : "allow",
  reasons: ["Template shadow policy."],
  riskTier: contract.riskTier,
  toolName: contract.name,
});
const hostAllows: PolicyEvaluator = ({ contract }) => ({
  status: "allow",
  reasons: ["Host runtime would allow."],
  riskTier: contract.riskTier,
  toolName: contract.name,
});

await createTraceGateFunctionRegistry(
  registry,
  {},
  {
    traceSink,
    onSummary: (summary) => {
      summaries.push(summary);
    },
    runtimeGateOptions: { mode: "observe" },
  },
).lookupCustomer.execute({ customerId: "cust_123" });
await createTraceGateFunctionRegistry(
  registry,
  {},
  {
    traceSink,
    onSummary: (summary) => {
      summaries.push(summary);
    },
    runtimeGateOptions: {
      mode: "shadow",
      policyEvaluator: traceGateBlocksWrites,
      runtimeVerdictEvaluator: hostAllows,
    },
  },
).draftOrder.execute({ symbol: "AAPL", quantity: 1 });
await createTraceGateFunctionRegistry(
  registry,
  {},
  {
    traceSink,
    onSummary: (summary) => {
      summaries.push(summary);
    },
    runtimeGateOptions: {
      mode: "enforce",
      enforcement: { validationOnly: true, toolNames: ["draftOrder"] },
    },
  },
)
  .draftOrder.execute({ symbol: "", quantity: 1 } as never)
  .catch(() => undefined);

console.log(
  JSON.stringify(
    {
      frameworkTool: openAiTool.name,
      sdkOutput,
      tracePath,
      summaries: summaries.map((summary) => ({
        mode: summary.mode,
        toolName: summary.toolName,
        riskTier: summary.riskTier,
        finalVerdict: summary.finalVerdict?.status,
        handlerExecuted: summary.handlerExecuted,
        sideEffectPrevented: summary.sideEffectPrevented,
        shadowComparison: summary.shadowComparison?.classifications,
      })),
    },
    null,
    2,
  ),
);
