import type { JsonObject, JsonValue, TraceEvent, TraceSink } from "@tracegate/core";

import { isToolTraceEvent } from "./common.js";

export interface LangfuseTraceEvent {
  id: string;
  traceId: string;
  name: string;
  type: TraceEvent["type"];
  timestamp: string;
  input?: JsonValue;
  output?: JsonValue;
  metadata: JsonObject;
}

export interface LangfuseTraceEventsOptions {
  traceId?: string;
  metadata?: JsonObject;
}

export interface LangfuseTraceSinkOptions extends LangfuseTraceEventsOptions {
  writer?: (event: LangfuseTraceEvent) => Promise<void> | void;
  flush?: () => Promise<void> | void;
}

export function toLangfuseTraceEvents(
  events: TraceEvent[],
  options: LangfuseTraceEventsOptions = {},
): LangfuseTraceEvent[] {
  return events.map((event) => toLangfuseTraceEvent(event, options));
}

export function createLangfuseTraceSink(options: LangfuseTraceSinkOptions = {}): TraceSink {
  return {
    async write(event) {
      if (!options.writer) {
        return;
      }
      await options.writer(toLangfuseTraceEvent(event, options));
    },
    async flush() {
      await options.flush?.();
    },
  };
}

function toLangfuseTraceEvent(
  event: TraceEvent,
  options: LangfuseTraceEventsOptions,
): LangfuseTraceEvent {
  const baseMetadata: JsonObject = {
    ...(options.metadata ?? {}),
    sequence: event.sequence,
    runId: event.runId,
  };

  if (event.type === "run.started" || event.type === "run.finished") {
    return {
      id: `${event.runId}-${event.sequence}`,
      traceId: options.traceId ?? event.runId,
      name: event.type,
      type: event.type,
      timestamp: event.timestamp,
      metadata: {
        ...baseMetadata,
        status: event.run.status,
        surfaceId: event.run.surface?.id ?? null,
        surfaceName: event.run.surface?.name ?? null,
        environment: event.run.surface?.environment ?? null,
        toolCallCount: event.run.toolCalls.length,
        evidenceCount: event.run.evidence.length,
      },
    };
  }

  if (event.type === "evidence.recorded") {
    return {
      id: `${event.runId}-${event.sequence}`,
      traceId: options.traceId ?? event.runId,
      name: `evidence.${event.record.type}`,
      type: event.type,
      timestamp: event.timestamp,
      output: event.record.metadata ?? null,
      metadata: {
        ...baseMetadata,
        evidenceId: event.record.id,
        evidenceType: event.record.type,
        source: event.record.source ?? null,
      },
    };
  }

  if (!isToolTraceEvent(event)) {
    throw new Error(`Unsupported TraceGate event type: ${event.type}`);
  }

  return {
    id: `${event.runId}-${event.sequence}`,
    traceId: options.traceId ?? event.runId,
    name: `tool.${event.record.toolName}.${event.record.status}`,
    type: event.type,
    timestamp: event.timestamp,
    input: event.record.input ?? null,
    output: event.record.output ?? null,
    metadata: {
      ...baseMetadata,
      toolName: event.record.toolName,
      status: event.record.status,
      riskTier: event.record.riskTier,
      policyVerdict: event.record.policyVerdict?.status ?? null,
      error: event.record.error ?? null,
    },
  };
}
