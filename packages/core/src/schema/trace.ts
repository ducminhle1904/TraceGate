import { z } from "zod";

import { EvidenceRecordSchema } from "../evidence/evidence.js";
import { PolicyVerdictSchema } from "../policy/verdict.js";
import { JsonObjectSchema, JsonValueSchema } from "./json.js";
import { HarnessContextSchema, HarnessSurfaceSchema } from "./surface.js";
import { RiskTierSchema, ToolNameSchema } from "./tool-contract.js";

export const ToolCallStatusSchema = z.enum(["started", "succeeded", "failed", "blocked"]);

export type ToolCallStatus = z.infer<typeof ToolCallStatusSchema>;

export const ToolCallRecordSchema = z
  .object({
    id: z.string().min(1),
    runId: z.string().min(1),
    toolName: ToolNameSchema,
    timestamp: z.string().datetime(),
    status: ToolCallStatusSchema,
    riskTier: RiskTierSchema,
    input: JsonValueSchema.optional(),
    output: JsonValueSchema.optional(),
    error: z.string().min(1).optional(),
    policyVerdict: PolicyVerdictSchema.optional(),
    metadata: JsonObjectSchema.optional(),
  })
  .strict();

export type ToolCallRecord = z.infer<typeof ToolCallRecordSchema>;

export const TraceGateRunStatusSchema = z.enum(["running", "succeeded", "failed", "blocked"]);

export type TraceGateRunStatus = z.infer<typeof TraceGateRunStatusSchema>;

export const TraceGateRunSchema = z
  .object({
    id: z.string().min(1),
    surface: HarnessSurfaceSchema.optional(),
    context: HarnessContextSchema.optional(),
    startedAt: z.string().datetime(),
    finishedAt: z.string().datetime().optional(),
    status: TraceGateRunStatusSchema,
    toolCalls: z.array(ToolCallRecordSchema).default([]),
    evidence: z.array(EvidenceRecordSchema).default([]),
    metadata: JsonObjectSchema.optional(),
  })
  .strict();

export type TraceGateRun = z.infer<typeof TraceGateRunSchema>;
