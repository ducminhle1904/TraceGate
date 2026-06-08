import type { ApprovalState } from "../policy/evaluate-policy.js";
import type { PolicyDiagnostic, PolicyVerdict } from "../policy/verdict.js";
import type { JsonObject } from "../schema/json.js";
import type { HarnessContext } from "../schema/surface.js";
import type { ToolContract } from "../schema/tool-contract.js";
import type { ApprovalHandler, ApprovalHandlerResult } from "./harness.js";

export interface ResolvePolicyVerdictInput {
  contract: ToolContract;
  input: unknown;
  context: HarnessContext;
  initialVerdict: PolicyVerdict;
  approvalHandler?: ApprovalHandler | undefined;
  evaluateWithApproval(
    approval: Exclude<ApprovalState, "missing">,
  ): PolicyVerdict | Promise<PolicyVerdict>;
}

export async function resolvePolicyVerdictAfterReview(
  input: ResolvePolicyVerdictInput,
): Promise<PolicyVerdict> {
  if (input.initialVerdict.status !== "review") {
    return input.initialVerdict;
  }

  const approvalResult = normalizeApprovalResult(
    await input.approvalHandler?.({
      contract: input.contract,
      input: input.input,
      context: input.context,
      verdict: input.initialVerdict,
    }),
  );

  if (approvalResult.status === "missing") {
    return appendPolicyDiagnostic(input.initialVerdict, {
      source: input.approvalHandler ? "approval-handler" : "runtime",
      rule: input.approvalHandler ? "approval-missing" : "approval-handler-missing",
      message:
        approvalResult.reason ??
        (input.approvalHandler
          ? "Approval handler returned missing approval."
          : "No approval handler is configured for a review verdict."),
      riskTier: input.contract.riskTier,
      approval: "missing",
    });
  }

  const resolved = await input.evaluateWithApproval(approvalResult.status);
  return appendPolicyDiagnostic(resolved, {
    source: "approval-handler",
    rule: `approval-${approvalResult.status}`,
    message: approvalResult.reason ?? `Approval handler returned "${approvalResult.status}".`,
    riskTier: input.contract.riskTier,
    approval: approvalResult.status,
  });
}

export function appendPolicyDiagnostic(
  verdict: PolicyVerdict,
  diagnostic: PolicyDiagnostic,
): PolicyVerdict {
  return {
    ...verdict,
    diagnostics: [...(verdict.diagnostics ?? []), diagnostic],
  };
}

function normalizeApprovalResult(result: ApprovalHandlerResult | undefined): {
  status: ApprovalState;
  reason?: string;
  metadata?: JsonObject;
} {
  if (result === undefined) {
    return { status: "missing" };
  }
  if (typeof result === "string") {
    return { status: result as ApprovalState };
  }
  return result;
}
