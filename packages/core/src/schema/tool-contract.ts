import { z } from "zod";

import { JsonObjectSchema } from "./json.js";

export const RiskTierSchema = z.enum(["read", "low", "medium", "high", "critical"]);

export type RiskTier = z.infer<typeof RiskTierSchema>;

export const ToolNameSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z][A-Za-z0-9_.:-]*$/, "Use a stable tool name without spaces");

export const SideEffectSchema = z
  .object({
    kind: z.string().min(1),
    description: z.string().min(1).optional(),
    external: z.boolean().optional(),
    mutates: z.boolean().optional(),
  })
  .strict();

export type SideEffect = z.infer<typeof SideEffectSchema>;

const ZodInputSchema = z.custom<z.ZodType<unknown>>(
  (value) => value instanceof z.ZodType,
  "inputSchema must be a Zod schema",
);

export const ToolContractConfigSchema = z
  .object({
    name: ToolNameSchema,
    description: z.string().min(1).optional(),
    riskTier: RiskTierSchema,
    requiresApproval: z.boolean().default(false),
    inputSchema: ZodInputSchema,
    sideEffects: z.array(SideEffectSchema).default([]),
    requiredEvidence: z.array(z.string().min(1)).default([]),
    metadata: JsonObjectSchema.default({}),
  })
  .strict();

export type ToolContractConfig<TInputSchema extends z.ZodType<unknown> = z.ZodType<unknown>> = Omit<
  z.input<typeof ToolContractConfigSchema>,
  "inputSchema"
> & {
  inputSchema: TInputSchema;
};

export type ToolContract<TInputSchema extends z.ZodType<unknown> = z.ZodType<unknown>> = Omit<
  z.output<typeof ToolContractConfigSchema>,
  "inputSchema"
> & {
  inputSchema: TInputSchema;
};

export function defineToolContract<TInputSchema extends z.ZodType<unknown>>(
  config: ToolContractConfig<TInputSchema>,
): ToolContract<TInputSchema> {
  return ToolContractConfigSchema.parse(config) as ToolContract<TInputSchema>;
}
