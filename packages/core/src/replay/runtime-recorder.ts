import {
  assertNoSecretLikeValues,
  detectSecretLikeValues,
  type RedactValueOptions,
  redactValue,
  TraceGateSecretLeakError,
} from "../redaction/redact.js";
import type { RuntimeGateSummary } from "../runtime/runtime-gate.js";
import { toJsonCompatible } from "../runtime/tool-record.js";
import { type TraceEvent, TraceEventSchema } from "../runtime/trace-sink.js";
import type { JsonObject } from "../schema/json.js";
import {
  createReplayExpectation,
  defineReplayFixture,
  type ReplayFixture,
  type ReplaySource,
  summarizeReplaySource,
} from "./replay-fixture.js";

export interface RuntimeReplayRecorderOptions extends RuntimeReplayFixtureOptions {}

export interface RuntimeReplayFixtureInput extends ReplaySource {
  summaries?: RuntimeGateSummary[] | unknown[] | undefined;
}

export interface RuntimeReplayFixtureOptions {
  allowSecretFindings?: boolean;
  caseId?: string;
  id?: string;
  metadata?: JsonObject;
  prompt?: string;
  redaction?: RedactValueOptions;
}

export interface RuntimeReplayRecorder {
  readonly traceSink: {
    write(event: TraceEvent): Promise<void> | void;
    flush(): Promise<void>;
  };
  readonly events: TraceEvent[];
  readonly summaries: unknown[];
  onSummary(summary: RuntimeGateSummary): void;
  recordEvent(event: TraceEvent): void;
  recordSummary(summary: RuntimeGateSummary | unknown): void;
  toFixture(options?: RuntimeReplayFixtureOptions): ReplayFixture;
  clear(): void;
}

export function createRuntimeReplayRecorder(
  options: RuntimeReplayRecorderOptions = {},
): RuntimeReplayRecorder {
  const events: TraceEvent[] = [];
  const summaries: unknown[] = [];

  return {
    traceSink: {
      write(event) {
        events.push(sanitizeTraceEvent(event, options));
      },
      async flush() {
        return undefined;
      },
    },
    events,
    summaries,
    onSummary(summary) {
      summaries.push(sanitizeJson(summary, options));
    },
    recordEvent(event) {
      events.push(sanitizeTraceEvent(event, options));
    },
    recordSummary(summary) {
      summaries.push(sanitizeJson(summary, options));
    },
    toFixture(overrideOptions = {}) {
      return createRuntimeReplayFixture(
        { events, summaries },
        {
          ...options,
          ...overrideOptions,
          metadata: {
            ...(options.metadata ?? {}),
            ...(overrideOptions.metadata ?? {}),
          },
        },
      );
    },
    clear() {
      events.length = 0;
      summaries.length = 0;
    },
  };
}

export function createRuntimeReplayFixture(
  input: RuntimeReplayFixtureInput,
  options: RuntimeReplayFixtureOptions = {},
): ReplayFixture {
  const events = (input.events ?? []).map((event) => sanitizeTraceEvent(event, options));
  const summaries = (input.summaries ?? []).map((summary) => sanitizeJson(summary, options));
  const output = input.output === undefined ? undefined : sanitizeJson(input.output, options);
  const id = options.id ?? options.caseId ?? "runtime-replay";
  const prompt = options.prompt ?? `Replay runtime trace ${id}`;
  const source = {
    events,
    ...(input.run ? { run: input.run } : {}),
    ...(output !== undefined ? { output } : {}),
  };

  return defineReplayFixture({
    version: "1",
    id,
    case: {
      id: options.caseId ?? id,
      prompt,
      expect: {},
    },
    captured: summarizeReplaySource(source),
    expect: createReplayExpectation(source, {
      traceEventCountMode: "tool-boundary",
      toolEventSequenceMode: "ordered-subset",
      stageSequenceMode: "ordered-subset",
      includeRunStatus: false,
    }),
    metadata: {
      sourceKind: "runtime-gate",
      summaryCount: summaries.length,
      ...(options.metadata ?? {}),
    },
  });
}

function sanitizeTraceEvent(event: TraceEvent, options: RuntimeReplayFixtureOptions): TraceEvent {
  const sanitized = sanitizeJson(event, options);
  return TraceEventSchema.parse(sanitized);
}

function sanitizeJson(value: unknown, options: RuntimeReplayFixtureOptions): unknown {
  if (options.allowSecretFindings !== true) {
    const rawFindings = detectSecretLikeValues(value, {
      ...options.redaction,
      detect: true,
      ignoreRedactionPlaceholders: true,
    }).filter((finding) => finding.kind !== "secret-key");
    if (rawFindings.length > 0) {
      throw new TraceGateSecretLeakError(rawFindings);
    }
  }
  const sanitized = toJsonCompatible(redactValue(value, options.redaction));
  if (options.allowSecretFindings !== true) {
    assertNoSecretLikeValues(sanitized, {
      ...options.redaction,
      detect: true,
      ignoreRedactionPlaceholders: true,
    });
  }
  return sanitized;
}
