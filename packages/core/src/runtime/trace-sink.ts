import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { EvidenceRecord } from "../evidence/evidence.js";
import type { ToolCallRecord, TraceGateRun } from "../schema/trace.js";

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
