import { z } from "zod";

import { JsonObjectSchema } from "./json.js";

export const RiskTierSchema = z.enum(["read", "low", "medium", "high", "critical"]);

export type RiskTier = z.infer<typeof RiskTierSchema>;

export const ToolSideEffectClassSchema = z.enum([
  "read",
  "draft",
  "client_mutation",
  "persisted_write",
  "external_side_effect",
]);

export type ToolSideEffectClass = z.infer<typeof ToolSideEffectClassSchema>;

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

export type TraceGateSafeParseResult<TOutput = unknown> =
  | { success: true; data: TOutput }
  | { success: false; error: unknown };

export interface TraceGateInputSchema<TInput = unknown, TOutput = TInput> {
  safeParse(input: TInput): TraceGateSafeParseResult<TOutput>;
}

export type InferToolInput<TInputSchema> = TInputSchema extends z.ZodType
  ? z.input<TInputSchema>
  : TInputSchema extends { safeParse(input: infer TInput): unknown }
    ? TInput
    : unknown;

export type InferToolOutput<TInputSchema> = TInputSchema extends z.ZodType
  ? z.output<TInputSchema>
  : TInputSchema extends { safeParse(input: infer _TInput): infer TResult }
    ? Extract<TResult, { success: true }> extends { data: infer TOutput }
      ? TOutput
      : unknown
    : unknown;

const ToolInputSchema = z.custom<TraceGateInputSchema>(
  (value) =>
    value !== null &&
    typeof value === "object" &&
    "safeParse" in value &&
    typeof value.safeParse === "function",
  "inputSchema must provide a safeParse(input) function",
);

export const ToolContractConfigSchema = z
  .object({
    name: ToolNameSchema,
    description: z.string().min(1).optional(),
    riskTier: RiskTierSchema,
    requiresApproval: z.boolean().default(false),
    inputSchema: ToolInputSchema,
    sideEffects: z.array(SideEffectSchema).default([]),
    sideEffectClass: ToolSideEffectClassSchema.optional(),
    requiredEvidence: z.array(z.string().min(1)).default([]),
    metadata: JsonObjectSchema.default({}),
  })
  .strict()
  .transform((config) => ({
    ...config,
    sideEffectClass: config.sideEffectClass ?? inferSideEffectClass(config.sideEffects),
  }));

export type ToolContractConfig<TInputSchema extends TraceGateInputSchema = TraceGateInputSchema> =
  Omit<z.input<typeof ToolContractConfigSchema>, "inputSchema"> & {
    inputSchema: TInputSchema;
  };

export type ToolContract<TInputSchema extends TraceGateInputSchema = TraceGateInputSchema> = Omit<
  z.output<typeof ToolContractConfigSchema>,
  "inputSchema"
> & {
  inputSchema: TInputSchema;
};

export function defineToolContract<TInputSchema extends TraceGateInputSchema>(
  config: ToolContractConfig<TInputSchema>,
): ToolContract<TInputSchema> {
  return ToolContractConfigSchema.parse(config) as ToolContract<TInputSchema>;
}

function inferSideEffectClass(sideEffects: SideEffect[]): ToolSideEffectClass {
  if (sideEffects.length === 0) {
    return "read";
  }
  if (sideEffects.some((sideEffect) => sideEffect.external === true)) {
    return "external_side_effect";
  }
  if (sideEffects.some((sideEffect) => sideEffect.mutates === true)) {
    return "persisted_write";
  }
  return "draft";
}
