import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createTraceGateFunctionRegistry } from "@tracegate/adapters/plain-functions";
import {
  createJsonlFileTraceSink,
  type PolicyEvaluator,
  type RuntimeGateSummary,
} from "@tracegate/core";
import { z } from "zod";

const here = dirname(fileURLToPath(import.meta.url));
const tracePath = join(here, "..", "traces", "runtime.jsonl");
await rm(tracePath, { force: true });
await mkdir(dirname(tracePath), { recursive: true });

const summaries: RuntimeGateSummary[] = [];
const traceSink = createJsonlFileTraceSink(tracePath);
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

const traceGateBlocksHighRisk: PolicyEvaluator = ({ contract }) => ({
  status: contract.riskTier === "medium" ? "block" : "allow",
  reasons: [`TraceGate ${contract.riskTier === "medium" ? "blocks" : "allows"} this tool.`],
  riskTier: contract.riskTier,
  toolName: contract.name,
});
const hostAllows: PolicyEvaluator = ({ contract }) => ({
  status: "allow",
  reasons: ["Host runtime would allow."],
  riskTier: contract.riskTier,
  toolName: contract.name,
});

const observeTools = createTraceGateFunctionRegistry(
  registry,
  {},
  {
    traceSink,
    onSummary: (summary) => {
      summaries.push(summary);
    },
    runtimeGateOptions: { mode: "observe" },
  },
);
await observeTools.lookupCustomer.execute({ customerId: "cust_123" });

const shadowTools = createTraceGateFunctionRegistry(
  registry,
  {},
  {
    traceSink,
    onSummary: (summary) => {
      summaries.push(summary);
    },
    runtimeGateOptions: {
      mode: "shadow",
      policyEvaluator: traceGateBlocksHighRisk,
      runtimeVerdictEvaluator: hostAllows,
    },
  },
);
await shadowTools.draftOrder.execute({ symbol: "AAPL", quantity: 1 });

const validationOnlyTools = createTraceGateFunctionRegistry(
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
);
await validationOnlyTools.draftOrder
  .execute({ symbol: "", quantity: 1 } as never)
  .catch(() => undefined);

console.log(
  JSON.stringify(
    {
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
