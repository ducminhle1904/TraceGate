import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { z } from "zod";

import { type EvidenceRecord, EvidenceRecordSchema } from "../evidence/evidence.js";
import {
  type ToolCallRecord,
  ToolCallRecordSchema,
  type TraceGateRun,
  TraceGateRunSchema,
} from "../schema/trace.js";

export interface RunTraceEvent {
  sequence: number;
  type: "run.started" | "run.finished";
  timestamp: string;
  runId: string;
  run: TraceGateRun;
}

export interface ToolTraceEvent {
  sequence: number;
  type: "tool.started" | "tool.succeeded" | "tool.failed" | "tool.blocked";
  timestamp: string;
  runId: string;
  record: ToolCallRecord;
}

export interface EvidenceTraceEvent {
  sequence: number;
  type: "evidence.recorded";
  timestamp: string;
  runId: string;
  record: EvidenceRecord;
}

export type TraceEvent = RunTraceEvent | ToolTraceEvent | EvidenceTraceEvent;

export const RunTraceEventSchema = z
  .object({
    sequence: z.number().int().nonnegative(),
    type: z.enum(["run.started", "run.finished"]),
    timestamp: z.string().datetime(),
    runId: z.string().min(1),
    run: TraceGateRunSchema,
  })
  .strict();

export const ToolTraceEventSchema = z
  .object({
    sequence: z.number().int().nonnegative(),
    type: z.enum(["tool.started", "tool.succeeded", "tool.failed", "tool.blocked"]),
    timestamp: z.string().datetime(),
    runId: z.string().min(1),
    record: ToolCallRecordSchema,
  })
  .strict();

export const EvidenceTraceEventSchema = z
  .object({
    sequence: z.number().int().nonnegative(),
    type: z.literal("evidence.recorded"),
    timestamp: z.string().datetime(),
    runId: z.string().min(1),
    record: EvidenceRecordSchema,
  })
  .strict();

export const TraceEventSchema = z.discriminatedUnion("type", [
  RunTraceEventSchema,
  ToolTraceEventSchema,
  EvidenceTraceEventSchema,
]);

export type TraceEventInput =
  | Omit<RunTraceEvent, "sequence">
  | Omit<ToolTraceEvent, "sequence">
  | Omit<EvidenceTraceEvent, "sequence">;

export interface TraceSink {
  write(event: TraceEvent): Promise<void> | void;
  flush?(): Promise<void> | void;
}

export interface MemoryTraceSink extends TraceSink {
  readonly events: TraceEvent[];
  clear(): void;
}

export interface StructuredLoggerTraceSinkOptions {
  log(event: TraceEvent): Promise<void> | void;
  flush?: () => Promise<void> | void;
}

export function createMemoryTraceSink(): MemoryTraceSink {
  const events: TraceEvent[] = [];

  return {
    events,
    write(event) {
      events.push(JSON.parse(JSON.stringify(event)) as TraceEvent);
    },
    clear() {
      events.length = 0;
    },
  };
}

export function createStructuredLoggerTraceSink(
  options: StructuredLoggerTraceSinkOptions,
): TraceSink {
  return {
    write(event) {
      return options.log(event);
    },
    flush() {
      return options.flush?.();
    },
  };
}

export function createJsonlFileTraceSink(filePath: string): TraceSink {
  let ensureDir: Promise<void> | undefined;
  let writeQueue: Promise<void> = Promise.resolve();

  return {
    write(event) {
      const line = `${JSON.stringify(event)}\n`;
      const writeOperation = writeQueue.then(async () => {
        ensureDir ??= mkdir(dirname(filePath), { recursive: true }).then(() => undefined);
        await ensureDir;
        await appendFile(filePath, line, "utf8");
      });
      writeQueue = writeOperation.catch(() => undefined);
      return writeOperation;
    },
    flush() {
      return writeQueue;
    },
  };
}
