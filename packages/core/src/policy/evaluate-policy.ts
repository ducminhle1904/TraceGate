import { z } from "zod";

import type { HarnessContext } from "../schema/surface.js";
import type { ToolContract } from "../schema/tool-contract.js";
import type { PolicyVerdict } from "./verdict.js";

export const ApprovalStateSchema = z.enum(["approved", "denied", "missing"]);

export type ApprovalState = z.infer<typeof ApprovalStateSchema>;

export interface EvaluatePolicyInput {
  contract: ToolContract;
  approval?: ApprovalState;
  context?: HarnessContext;
}

export function evaluatePolicy(input: EvaluatePolicyInput): PolicyVerdict {
  const { contract } = input;

  const verdict = (status: PolicyVerdict["status"], reason: string): PolicyVerdict => ({
    status,
    reasons: [reason],
    riskTier: contract.riskTier,
    toolName: contract.name,
  });

  if (input.approval === "denied") {
    return verdict("block", "Required approval was denied.");
  }

  if (!contract.requiresApproval) {
    return verdict("allow", "Tool does not require approval.");
  }

  if (input.approval === "approved") {
    return verdict("allow", "Required approval is present.");
  }

  return verdict("review", "Required approval is missing.");
}
