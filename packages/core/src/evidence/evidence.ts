import { z } from "zod";

import { JsonObjectSchema, JsonValueSchema } from "../schema/json.js";

export const EvidenceTypeSchema = z.enum([
  "retrieval",
  "memory",
  "tool-output",
  "user-approval",
  "system",
]);

export type EvidenceType = z.infer<typeof EvidenceTypeSchema>;

export const EvidenceRecordSchema = z
  .object({
    id: z.string().min(1),
    type: EvidenceTypeSchema,
    timestamp: z.string().datetime(),
    source: z.string().min(1).optional(),
    content: JsonValueSchema.optional(),
    redacted: z.boolean().default(false),
    metadata: JsonObjectSchema.optional(),
  })
  .strict();

export type EvidenceRecord = z.infer<typeof EvidenceRecordSchema>;
