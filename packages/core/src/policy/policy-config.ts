import { z } from "zod";

import type { EvidenceRecord } from "../evidence/evidence.js";
import type { Environment } from "../schema/surface.js";
import { EnvironmentSchema } from "../schema/surface.js";
import type { RiskTier, ToolContract } from "../schema/tool-contract.js";
import { RiskTierSchema, ToolNameSchema } from "../schema/tool-contract.js";
import type { EvaluatePolicyInput } from "./evaluate-policy.js";
import type { PolicyVerdict } from "./verdict.js";

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
      return verdict(input.contract, "block", "Required approval was denied.");
    }

    if (includesRiskTier(effective.blockRiskTiers, input.contract.riskTier)) {
      return verdict(input.contract, "block", `Risk tier "${input.contract.riskTier}" is blocked.`);
    }

    if (requiresApproval(effective, input.contract) && input.approval !== "approved") {
      return verdict(input.contract, "review", "Required approval is missing.");
    }

    const missingEvidence = missingRequiredEvidence(requiredEvidence, input.evidence ?? []);
    if (missingEvidence.length > 0) {
      return verdict(
        input.contract,
        "review",
        `Missing required evidence: ${missingEvidence.join(", ")}.`,
      );
    }

    return verdict(input.contract, "allow", "Policy requirements are satisfied.");
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
): PolicyVerdict {
  return {
    status,
    reasons: [reason],
    riskTier: contract.riskTier,
    toolName: contract.name,
  };
}
