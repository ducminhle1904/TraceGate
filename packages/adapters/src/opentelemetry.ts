import { type Attributes, type Span, SpanStatusCode, type Tracer, trace } from "@opentelemetry/api";
import type { TraceEvent, TraceSink } from "@tracegate/core";

import { isToolTraceEvent } from "./common.js";

export interface OpenTelemetryTraceSinkOptions {
  tracer?: Tracer;
  tracerName?: string;
  attributes?: Attributes;
  endSpan?: (span: Span, event: TraceEvent) => void;
  flush?: () => Promise<void> | void;
}

export function createOpenTelemetryTraceSink(
  options: OpenTelemetryTraceSinkOptions = {},
): TraceSink {
  const tracer = options.tracer ?? trace.getTracer(options.tracerName ?? "@tracegate/adapters");

  return {
    write(event) {
      const span = tracer.startSpan(getSpanName(event), {
        attributes: {
          ...options.attributes,
          ...mapTraceEventToOpenTelemetryAttributes(event),
        },
      });

      if (event.type === "tool.failed" || event.type === "tool.blocked") {
        const message = event.record.error ?? event.record.policyVerdict?.status;
        span.setStatus({
          code: SpanStatusCode.ERROR,
          ...(message ? { message } : {}),
        });
      }

      try {
        options.endSpan?.(span, event);
      } finally {
        span.end();
      }
    },
    flush() {
      return options.flush?.();
    },
  };
}

export function mapTraceEventToOpenTelemetryAttributes(event: TraceEvent): Attributes {
  const attributes: Attributes = {
    "tracegate.sequence": event.sequence,
    "tracegate.event.type": event.type,
    "tracegate.run.id": event.runId,
  };

  if (event.type === "run.started" || event.type === "run.finished") {
    attributes["tracegate.run.status"] = event.run.status;
    attributes["tracegate.run.tool_call_count"] = event.run.toolCalls.length;
    attributes["tracegate.run.evidence_count"] = event.run.evidence.length;
    if (event.run.surface) {
      attributes["tracegate.surface.id"] = event.run.surface.id;
      if (event.run.surface.name) {
        attributes["tracegate.surface.name"] = event.run.surface.name;
      }
      if (event.run.surface.environment) {
        attributes["tracegate.environment"] = event.run.surface.environment;
      }
    }
  }

  if (isToolTraceEvent(event)) {
    attributes["tracegate.tool.name"] = event.record.toolName;
    attributes["tracegate.tool.status"] = event.record.status;
    attributes["tracegate.tool.risk_tier"] = event.record.riskTier;
    if (event.record.policyVerdict) {
      attributes["tracegate.policy.status"] = event.record.policyVerdict.status;
    }
  }

  if (event.type === "evidence.recorded") {
    attributes["tracegate.evidence.id"] = event.record.id;
    attributes["tracegate.evidence.type"] = event.record.type;
    attributes["tracegate.evidence.source"] = event.record.source;
  }

  return attributes;
}

function getSpanName(event: TraceEvent): string {
  if (isToolTraceEvent(event)) {
    return `tracegate.tool.${event.record.toolName}.${event.record.status}`;
  }

  return `tracegate.${event.type}`;
}
