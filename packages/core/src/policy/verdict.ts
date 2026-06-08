import { z } from "zod";

import { RiskTierSchema, ToolNameSchema } from "../schema/tool-contract.js";

export const PolicyVerdictStatusSchema = z.enum(["allow", "warn", "block", "review"]);

export type PolicyVerdictStatus = z.infer<typeof PolicyVerdictStatusSchema>;

export const PolicyDiagnosticSourceSchema = z.enum([
  "contract",
  "policy",
  "approval-handler",
  "runtime",
]);

export type PolicyDiagnosticSource = z.infer<typeof PolicyDiagnosticSourceSchema>;

export const PolicyDiagnosticSchema = z
  .object({
    source: PolicyDiagnosticSourceSchema,
    rule: z.string().min(1),
    message: z.string().min(1),
    riskTier: RiskTierSchema.optional(),
    approval: z.enum(["approved", "denied", "missing"]).optional(),
    evidenceIds: z.array(z.string().min(1)).optional(),
  })
  .strict();

export type PolicyDiagnostic = z.infer<typeof PolicyDiagnosticSchema>;

export const PolicyVerdictSchema = z
  .object({
    status: PolicyVerdictStatusSchema,
    reasons: z.array(z.string().min(1)),
    riskTier: RiskTierSchema,
    toolName: ToolNameSchema,
    diagnostics: z.array(PolicyDiagnosticSchema).optional(),
  })
  .strict();

export type PolicyVerdict = z.infer<typeof PolicyVerdictSchema>;
