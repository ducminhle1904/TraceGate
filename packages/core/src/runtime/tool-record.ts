import { type RedactValueOptions, redactValue } from "../redaction/redact.js";
import type { JsonObject, JsonValue } from "../schema/json.js";
import { JsonObjectSchema, JsonValueSchema } from "../schema/json.js";
import type { ToolCallRecord } from "../schema/trace.js";
import { ToolCallRecordSchema } from "../schema/trace.js";

export type ToolCallRecordInput = Omit<
  ToolCallRecord,
  "id" | "runId" | "timestamp" | "input" | "output" | "metadata"
> & {
  input?: JsonValue | undefined;
  output?: unknown;
  metadata?: unknown;
};

export interface CreateToolCallRecordInput {
  runId: string;
  redaction?: RedactValueOptions | undefined;
  record: ToolCallRecordInput;
}

export function createToolCallRecord(input: CreateToolCallRecordInput): {
  record: ToolCallRecord;
  timestamp: string;
} {
  const timestamp = nowIso();
  const {
    input: toolInput,
    output: toolOutput,
    metadata: toolMetadata,
    ...recordInput
  } = input.record;
  const record = ToolCallRecordSchema.parse({
    ...recordInput,
    id: createId("tool"),
    runId: input.runId,
    timestamp,
    ...(toolInput !== undefined ? { input: toolInput } : {}),
    ...(toolOutput !== undefined ? { output: toJsonValue(toolOutput, input.redaction) } : {}),
    ...(toolMetadata !== undefined
      ? { metadata: toJsonObject(toolMetadata, input.redaction) }
      : {}),
  });

  return { record, timestamp };
}

export function toJsonValue(value: unknown, redaction?: RedactValueOptions): JsonValue | undefined {
  if (value === undefined) {
    return undefined;
  }
  return JsonValueSchema.parse(toJsonCompatible(redactValue(value, redaction)));
}

export function toJsonObject(
  value: unknown,
  redaction?: RedactValueOptions,
): JsonObject | undefined {
  if (value === undefined) {
    return undefined;
  }
  return JsonObjectSchema.parse(toJsonCompatible(redactValue(value, redaction)));
}

export function toJsonCompatible(value: unknown): unknown {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? String(value) : JSON.parse(serialized);
  } catch {
    return "[UNSERIALIZABLE]";
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
