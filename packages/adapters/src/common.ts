import {
  type CreateHarnessOptions,
  createHarness,
  createRuntimeGate,
  type Harness,
  type RuntimeGate,
  type RuntimeGateOptions,
  type RuntimeGateSummary,
  type TraceEvent,
  type TraceSink,
} from "@tracegate/core";

export interface TraceGateAdapterOptions {
  harness?: Harness;
  harnessOptions?: CreateHarnessOptions;
  description?: string;
  onTraceEvent?: (event: TraceEvent) => Promise<void> | void;
}

export interface TraceGateRuntimeAdapterOptions {
  runtimeGate?: RuntimeGate;
  runtimeGateOptions?: Partial<RuntimeGateOptions> & Pick<RuntimeGateOptions, "mode">;
  description?: string;
  traceSink?: TraceSink;
  onSummary?: (summary: RuntimeGateSummary) => Promise<void> | void;
}

export function resolveHarness(options: TraceGateAdapterOptions = {}): Harness {
  if (options.harness) {
    if (options.onTraceEvent) {
      throw new Error(
        "onTraceEvent can only be used when the adapter creates the harness. Pass a traceSink to the existing harness instead.",
      );
    }
    return options.harness;
  }

  if (!options.onTraceEvent) {
    return createHarness(options.harnessOptions);
  }

  return createHarness({
    ...options.harnessOptions,
    traceSink: createCallbackTraceSink(options.harnessOptions?.traceSink, options.onTraceEvent),
  });
}

export function resolveDescription(
  description: string | undefined,
  fallback: string | undefined,
  toolName: string,
): string {
  return description ?? fallback ?? `TraceGate guarded tool: ${toolName}`;
}

export function resolveRuntimeGate(options: TraceGateRuntimeAdapterOptions = {}): RuntimeGate {
  if (options.runtimeGate) {
    if (options.traceSink || options.onSummary || options.runtimeGateOptions) {
      throw new Error(
        "traceSink, onSummary, and runtimeGateOptions can only be used when the adapter creates the runtime gate.",
      );
    }
    return options.runtimeGate;
  }
  if (options.traceSink && options.runtimeGateOptions?.traceSink) {
    throw new Error(
      "traceSink cannot be provided both at the adapter top level and inside runtimeGateOptions.",
    );
  }
  if (options.onSummary && options.runtimeGateOptions?.onSummary) {
    throw new Error(
      "onSummary cannot be provided both at the adapter top level and inside runtimeGateOptions.",
    );
  }

  const runtimeGateOptions: RuntimeGateOptions = {
    mode: options.runtimeGateOptions?.mode ?? "observe",
    ...options.runtimeGateOptions,
  };
  const traceSink = options.traceSink ?? options.runtimeGateOptions?.traceSink;
  if (traceSink) {
    runtimeGateOptions.traceSink = traceSink;
  }
  const onSummary = options.onSummary ?? options.runtimeGateOptions?.onSummary;
  if (onSummary) {
    runtimeGateOptions.onSummary = onSummary;
  }

  return createRuntimeGate(runtimeGateOptions);
}

export function isToolTraceEvent(
  event: TraceEvent,
): event is Extract<
  TraceEvent,
  { type: "tool.started" | "tool.succeeded" | "tool.failed" | "tool.blocked" }
> {
  return (
    event.type === "tool.started" ||
    event.type === "tool.succeeded" ||
    event.type === "tool.failed" ||
    event.type === "tool.blocked"
  );
}

function createCallbackTraceSink(
  inner: TraceSink | undefined,
  onTraceEvent: (event: TraceEvent) => Promise<void> | void,
): TraceSink {
  return {
    async write(event) {
      await inner?.write(event);
      await onTraceEvent(event);
    },
    async flush() {
      await inner?.flush?.();
    },
  };
}
