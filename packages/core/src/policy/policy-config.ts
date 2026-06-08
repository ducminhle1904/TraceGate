import { z } from "zod";

import type { EvidenceRecord } from "../evidence/evidence.js";
import type { Environment } from "../schema/surface.js";
import { EnvironmentSchema } from "../schema/surface.js";
import type { RiskTier, ToolContract } from "../schema/tool-contract.js";
import { RiskTierSchema, ToolNameSchema } from "../schema/tool-contract.js";
import type { EvaluatePolicyInput } from "./evaluate-policy.js";
import type { PolicyDiagnostic, PolicyVerdict } from "./verdict.js";

export interface PolicyConfig {
  requireApprovalForRiskTiers?: RiskTier[] | undefined;
  blockRiskTiers?: RiskTier[] | undefined;
  environmentOverrides?: Partial<Record<Environment, PolicyConfig>> | undefined;
  toolOverrides?: Record<string, PolicyConfig> | undefined;
  requiredEvidence?: Record<string, string[]> | undefined;
}

export const PolicyConfigSchema: z.ZodType<PolicyConfig> = z.lazy(() =>
  z
    .object({
      requireApprovalForRiskTiers: z.array(RiskTierSchema).optional(),
      blockRiskTiers: z.array(RiskTierSchema).optional(),
      environmentOverrides: z.partialRecord(EnvironmentSchema, PolicyConfigSchema).optional(),
      toolOverrides: z.record(ToolNameSchema, PolicyConfigSchema).optional(),
      requiredEvidence: z.record(ToolNameSchema, z.array(z.string().min(1))).optional(),
    })
    .strict(),
);

export function definePolicy(config: PolicyConfig): PolicyConfig {
  return PolicyConfigSchema.parse(config);
}

export function createPolicyEvaluator(policy: PolicyConfig) {
  const basePolicy = definePolicy(policy);

  return (input: EvaluatePolicyInput): PolicyVerdict => {
    const effective = resolveEffectivePolicy(basePolicy, input);
    const requiredEvidence = [
      ...input.contract.requiredEvidence,
      ...getRequiredEvidence(effective, input.contract.name),
    ];

    if (input.approval === "denied") {
      return verdict(input.contract, "block", "Required approval was denied.", {
        source: "policy",
        rule: "approval-denied",
        message: "Explicit denied approval blocks the tool call.",
        riskTier: input.contract.riskTier,
        approval: "denied",
      });
    }

    if (includesRiskTier(effective.blockRiskTiers, input.contract.riskTier)) {
      return verdict(
        input.contract,
        "block",
        `Risk tier "${input.contract.riskTier}" is blocked.`,
        {
          source: "policy",
          rule: "blocked-risk-tier",
          message: `Policy blocks risk tier "${input.contract.riskTier}".`,
          riskTier: input.contract.riskTier,
        },
      );
    }

    if (requiresApproval(effective, input.contract) && input.approval !== "approved") {
      return verdict(input.contract, "review", "Required approval is missing.", {
        source: input.contract.requiresApproval ? "contract" : "policy",
        rule: input.contract.requiresApproval
          ? "contract-requires-approval"
          : "risk-tier-requires-approval",
        message: input.contract.requiresApproval
          ? "Tool contract requires approval before execution."
          : `Policy requires approval for risk tier "${input.contract.riskTier}".`,
        riskTier: input.contract.riskTier,
        approval: input.approval ?? "missing",
      });
    }

    const missingEvidence = missingRequiredEvidence(requiredEvidence, input.evidence ?? []);
    if (missingEvidence.length > 0) {
      return verdict(
        input.contract,
        "review",
        `Missing required evidence: ${missingEvidence.join(", ")}.`,
        {
          source: "policy",
          rule: "missing-required-evidence",
          message: `Missing required evidence: ${missingEvidence.join(", ")}.`,
          riskTier: input.contract.riskTier,
          evidenceIds: (input.evidence ?? []).map((record) => record.id),
        },
      );
    }

    return verdict(input.contract, "allow", "Policy requirements are satisfied.", {
      source: "policy",
      rule: "policy-satisfied",
      message: "Policy requirements are satisfied.",
      riskTier: input.contract.riskTier,
      ...(input.approval ? { approval: input.approval } : {}),
    });
  };
}

function resolveEffectivePolicy(policy: PolicyConfig, input: EvaluatePolicyInput): PolicyConfig {
  const environment = input.environment ?? input.context?.surface?.environment;
  const environmentPolicy = environment ? policy.environmentOverrides?.[environment] : undefined;
  const toolPolicy = policy.toolOverrides?.[input.contract.name];
  const requiredEvidence = mergeRequiredEvidence(
    policy.requiredEvidence,
    environmentPolicy?.requiredEvidence,
    toolPolicy?.requiredEvidence,
  );

  return {
    requireApprovalForRiskTiers:
      toolPolicy?.requireApprovalForRiskTiers ??
      environmentPolicy?.requireApprovalForRiskTiers ??
      policy.requireApprovalForRiskTiers,
    blockRiskTiers:
      toolPolicy?.blockRiskTiers ?? environmentPolicy?.blockRiskTiers ?? policy.blockRiskTiers,
    ...(requiredEvidence ? { requiredEvidence } : {}),
  };
}

function requiresApproval(policy: PolicyConfig, contract: ToolContract): boolean {
  return (
    contract.requiresApproval ||
    includesRiskTier(policy.requireApprovalForRiskTiers, contract.riskTier)
  );
}

function includesRiskTier(riskTiers: RiskTier[] | undefined, riskTier: RiskTier): boolean {
  return riskTiers?.includes(riskTier) ?? false;
}

function getRequiredEvidence(policy: PolicyConfig, toolName: string): string[] {
  return Array.from(new Set(policy.requiredEvidence?.[toolName] ?? []));
}

function missingRequiredEvidence(requiredEvidence: string[], evidence: EvidenceRecord[]): string[] {
  const evidenceTexts = evidence.map(evidenceSearchText);
  return Array.from(new Set(requiredEvidence)).filter(
    (required) => !evidenceTexts.some((text) => text.includes(required)),
  );
}

function mergeRequiredEvidence(
  ...configs: Array<Record<string, string[]> | undefined>
): Record<string, string[]> | undefined {
  const merged: Record<string, string[]> = {};

  for (const config of configs) {
    for (const [toolName, required] of Object.entries(config ?? {})) {
      merged[toolName] = Array.from(new Set([...(merged[toolName] ?? []), ...required]));
    }
  }

  return Object.keys(merged).length > 0 ? merged : undefined;
}

function evidenceSearchText(record: EvidenceRecord): string {
  return JSON.stringify({
    id: record.id,
    type: record.type,
    source: record.source,
    content: record.content,
    metadata: record.metadata,
  });
}

function verdict(
  contract: ToolContract,
  status: PolicyVerdict["status"],
  reason: string,
  diagnostic: PolicyDiagnostic,
): PolicyVerdict {
  return {
    status,
    reasons: [reason],
    riskTier: contract.riskTier,
    toolName: contract.name,
    diagnostics: [diagnostic],
  };
}
