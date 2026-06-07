import { z } from "zod";

import { JsonObjectSchema } from "./json.js";

export const EnvironmentSchema = z.enum(["local", "development", "test", "staging", "production"]);

export type Environment = z.infer<typeof EnvironmentSchema>;

export const HarnessSurfaceSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1).optional(),
    environment: EnvironmentSchema.optional(),
    metadata: JsonObjectSchema.optional(),
  })
  .strict();

export type HarnessSurface = z.infer<typeof HarnessSurfaceSchema>;

export const HarnessContextSchema = z
  .object({
    runId: z.string().min(1).optional(),
    surface: HarnessSurfaceSchema.optional(),
    userId: z.string().min(1).optional(),
    sessionId: z.string().min(1).optional(),
    metadata: JsonObjectSchema.optional(),
  })
  .strict();

export type HarnessContext = z.infer<typeof HarnessContextSchema>;
