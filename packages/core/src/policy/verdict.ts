import { z } from "zod";

import { RiskTierSchema, ToolNameSchema } from "../schema/tool-contract.js";

export const PolicyVerdictStatusSchema = z.enum(["allow", "warn", "block", "review"]);

export type PolicyVerdictStatus = z.infer<typeof PolicyVerdictStatusSchema>;

export const PolicyVerdictSchema = z
  .object({
    status: PolicyVerdictStatusSchema,
    reasons: z.array(z.string().min(1)),
    riskTier: RiskTierSchema,
    toolName: ToolNameSchema,
  })
  .strict();

export type PolicyVerdict = z.infer<typeof PolicyVerdictSchema>;
