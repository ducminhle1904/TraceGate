import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createTraceGateVercelAITool } from "@tracegate/adapters/vercel-ai-sdk";
import {
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
type DraftOrderManifest = typeof registry.draftOrder;

const lookupContract = defineToolContractFromManifest(registry.lookupCustomer, {
  name: "lookupCustomer",
  riskTier: (manifest: LookupManifest) => manifest.riskTier,
  inputSchema: (manifest: LookupManifest) => manifest.inputSchema,
  description: (manifest: LookupManifest) => manifest.description,
});
const draftOrderContract = defineToolContractFromManifest(registry.draftOrder, {
  name: "draftOrder",
  riskTier: (manifest: DraftOrderManifest) => manifest.riskTier,
  inputSchema: (manifest: DraftOrderManifest) => manifest.inputSchema,
  description: (manifest: DraftOrderManifest) => manifest.description,
  requiresApproval: (manifest: DraftOrderManifest) => manifest.requiresApproval,
});

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

const observeLookup = createTraceGateVercelAITool(lookupContract, registry.lookupCustomer.execute, {
  traceSink,
  onSummary: (summary) => {
    summaries.push(summary);
  },
  runtimeGateOptions: { mode: "observe" },
});
await observeLookup.execute?.(
  { customerId: "cust_123" },
  { toolCallId: "call_observe", messages: [] },
);

const shadowDraft = createTraceGateVercelAITool(draftOrderContract, registry.draftOrder.execute, {
  traceSink,
  onSummary: (summary) => {
    summaries.push(summary);
  },
  runtimeGateOptions: {
    mode: "shadow",
    policyEvaluator: traceGateBlocksWrites,
    runtimeVerdictEvaluator: hostAllows,
  },
});
await shadowDraft.execute?.(
  { symbol: "AAPL", quantity: 1 },
  { toolCallId: "call_shadow", messages: [] },
);

const validationOnlyDraft = createTraceGateVercelAITool(
  draftOrderContract,
  registry.draftOrder.execute,
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
try {
  await validationOnlyDraft.execute?.(
    { symbol: "", quantity: 1 },
    { toolCallId: "call_validation", messages: [] },
  );
} catch {
  // Validation-only enforcement should prevent the side-effecting handler.
}

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
