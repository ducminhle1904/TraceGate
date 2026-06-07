import { z } from "zod";

import { PolicyVerdictStatusSchema } from "../policy/verdict.js";
import { JsonObjectSchema } from "./json.js";
import { HarnessSurfaceSchema } from "./surface.js";
import { ToolNameSchema } from "./tool-contract.js";

export const MatrixCaseExpectationSchema = z
  .object({
    requiredTools: z.array(ToolNameSchema).optional(),
    forbiddenTools: z.array(ToolNameSchema).optional(),
    orderedToolSequence: z.array(ToolNameSchema).optional(),
    requiredPolicyVerdict: PolicyVerdictStatusSchema.optional(),
    requiredEvidence: z.array(z.string().min(1)).optional(),
    outputKeys: z.array(z.string().min(1)).optional(),
    redactionChecks: z.array(z.string().min(1)).optional(),
  })
  .strict();

export type MatrixCaseExpectation = z.infer<typeof MatrixCaseExpectationSchema>;

export const MatrixCaseSchema = z
  .object({
    id: z.string().min(1),
    prompt: z.string().min(1),
    surface: HarnessSurfaceSchema.optional(),
    expect: MatrixCaseExpectationSchema.default({}),
    metadata: JsonObjectSchema.optional(),
  })
  .strict();

export type MatrixCase = z.infer<typeof MatrixCaseSchema>;
