import { z } from "zod";

import type { EvidenceRecord } from "../evidence/evidence.js";
import type { Environment, HarnessContext } from "../schema/surface.js";
import type { ToolContract } from "../schema/tool-contract.js";
import type { PolicyDiagnostic, PolicyVerdict } from "./verdict.js";

export const ApprovalStateSchema = z.enum(["approved", "denied", "missing"]);

export type ApprovalState = z.infer<typeof ApprovalStateSchema>;

export interface EvaluatePolicyInput {
  contract: ToolContract;
  approval?: ApprovalState;
  context?: HarnessContext;
  environment?: Environment | undefined;
  evidence?: EvidenceRecord[] | undefined;
  input?: unknown;
}

export function evaluatePolicy(input: EvaluatePolicyInput): PolicyVerdict {
  const { contract } = input;

  const verdict = (
    status: PolicyVerdict["status"],
    reason: string,
    diagnostic: PolicyDiagnostic,
  ): PolicyVerdict => ({
    status,
    reasons: [reason],
    riskTier: contract.riskTier,
    toolName: contract.name,
    diagnostics: [diagnostic],
  });

  if (input.approval === "denied") {
    return verdict("block", "Required approval was denied.", {
      source: "contract",
      rule: "approval-denied",
      message: "Required approval was denied.",
      riskTier: contract.riskTier,
      approval: "denied",
    });
  }

  if (!contract.requiresApproval) {
    return verdict("allow", "Tool does not require approval.", {
      source: "contract",
      rule: "approval-not-required",
      message: "Tool contract does not require approval.",
      riskTier: contract.riskTier,
    });
  }

  if (input.approval === "approved") {
    return verdict("allow", "Required approval is present.", {
      source: "contract",
      rule: "approval-present",
      message: "Required approval is present.",
      riskTier: contract.riskTier,
      approval: "approved",
    });
  }

  return verdict("review", "Required approval is missing.", {
    source: "contract",
    rule: "approval-missing",
    message: "Tool contract requires approval before execution.",
    riskTier: contract.riskTier,
    approval: "missing",
  });
}
