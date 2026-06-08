import { StringDecoder } from "node:string_decoder";
import { z } from "zod";

import { EvidenceTypeSchema } from "../evidence/evidence.js";
import { PolicyVerdictStatusSchema } from "../policy/verdict.js";
import { type RunTraceEvent, type TraceEvent, TraceEventSchema } from "../runtime/trace-sink.js";
import { JsonObjectSchema } from "../schema/json.js";
import { MatrixCaseSchema } from "../schema/matrix-case.js";
import { ToolNameSchema } from "../schema/tool-contract.js";
import {
  type ToolCallRecord,
  ToolCallStatusSchema,
  type TraceGateRun,
  TraceGateRunSchema,
  TraceGateRunStatusSchema,
} from "../schema/trace.js";

export const ReplayEvidenceExpectationSchema = z
  .object({
    id: z.string().min(1),
    type: EvidenceTypeSchema,
  })
  .strict();

export const ReplayOutputKeysModeSchema = z.enum(["exact", "subset"]);

export type ReplayOutputKeysMode = z.infer<typeof ReplayOutputKeysModeSchema>;

export const ReplayExpectationSchema = z
  .object({
    toolSequence: z.array(ToolNameSchema).default([]),
    toolStatuses: z.record(ToolNameSchema, z.array(ToolCallStatusSchema)).default({}),
    policyVerdicts: z.record(ToolNameSchema, z.array(PolicyVerdictStatusSchema)).default({}),
    evidence: z.array(ReplayEvidenceExpectationSchema).default([]),
    runStatus: TraceGateRunStatusSchema.optional(),
    outputKeys: z.array(z.string().min(1)).default([]),
    outputKeysMode: ReplayOutputKeysModeSchema.default("exact"),
    ignoredOutputKeys: z.array(z.string().min(1)).default([]),
    optionalOutputKeys: z.array(z.string().min(1)).default([]),
    traceEventCount: z.number().int().nonnegative().default(0),
  })
  .strict();

export type ReplayExpectation = z.infer<typeof ReplayExpectationSchema>;

export const ReplayTraceSummarySchema = z
  .object({
    traceEventCount: z.number().int().nonnegative(),
    runId: z.string().min(1).optional(),
    runStatus: TraceGateRunStatusSchema.optional(),
  })
  .strict();

export type ReplayTraceSummary = z.infer<typeof ReplayTraceSummarySchema>;

export const ReplayFixtureSchema = z
  .object({
    version: z.literal("1"),
    id: z.string().min(1),
    case: MatrixCaseSchema,
    captured: ReplayTraceSummarySchema,
    expect: ReplayExpectationSchema,
    metadata: JsonObjectSchema.optional(),
  })
  .strict()
  .superRefine((fixture, context) => {
    if (fixture.captured.traceEventCount !== fixture.expect.traceEventCount) {
      context.addIssue({
        code: "custom",
        path: ["expect", "traceEventCount"],
        message: "Replay fixture trace event counts must match captured.traceEventCount.",
      });
    }
  });

export type ReplayFixture = z.infer<typeof ReplayFixtureSchema>;
export type ReplayFixtureInput = z.input<typeof ReplayFixtureSchema>;

export interface ReplaySource {
  events?: TraceEvent[];
  run?: TraceGateRun;
  output?: unknown;
}

export interface ReplayComparisonResult {
  failures: string[];
  actual: ReplayExpectation;
}

export interface CreateReplayExpectationOptions {
  outputKeysMode?: ReplayOutputKeysMode;
  ignoredOutputKeys?: string[];
  optionalOutputKeys?: string[];
}

export type TraceJsonlChunk = string | Uint8Array;

export function defineReplayFixture(input: ReplayFixtureInput): ReplayFixture {
  return ReplayFixtureSchema.parse(input);
}

export function parseTraceJsonl(input: string): TraceEvent[] {
  const events: TraceEvent[] = [];
  const lines = input.split(/\r?\n/);

  for (const [index, line] of lines.entries()) {
    const event = parseTraceJsonlLine(line, index + 1);
    if (event) {
      events.push(event);
    }
  }

  return events;
}

export async function parseTraceJsonlStream(
  chunks: AsyncIterable<TraceJsonlChunk>,
): Promise<TraceEvent[]> {
  const events: TraceEvent[] = [];
  const decoder = new StringDecoder("utf8");
  let buffered = "";
  let lineNumber = 0;

  for await (const chunk of chunks) {
    buffered += typeof chunk === "string" ? chunk : decoder.write(chunk);
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";

    for (const line of lines) {
      lineNumber += 1;
      const event = parseTraceJsonlLine(line, lineNumber);
      if (event) {
        events.push(event);
      }
    }
  }

  buffered += decoder.end();
  if (buffered.length > 0) {
    lineNumber += 1;
    const event = parseTraceJsonlLine(buffered, lineNumber);
    if (event) {
      events.push(event);
    }
  }

  return events;
}

export function summarizeReplaySource(source: ReplaySource): ReplayTraceSummary {
  const run = getSourceRun(source);
  return ReplayTraceSummarySchema.parse({
    traceEventCount: source.events?.length ?? 0,
    ...(run?.id ? { runId: run.id } : {}),
    ...(run?.status ? { runStatus: run.status } : {}),
  });
}

export function createReplayExpectation(
  source: ReplaySource,
  options: CreateReplayExpectationOptions = {},
): ReplayExpectation {
  const run = getSourceRun(source);
  const events = source.events ?? [];
  const toolEvents = events.filter(isToolEvent);
  const toolRecords = run?.toolCalls ?? toolEvents.map((event) => event.record);
  const evidence = run?.evidence ?? events.filter(isEvidenceEvent).map((event) => event.record);
  const toolSequence =
    toolEvents.length > 0
      ? toolEvents
          .filter((event) => event.type === "tool.started")
          .map((event) => event.record.toolName)
      : toolRecords
          .filter((record) => record.status === "started")
          .map((record) => record.toolName);

  return ReplayExpectationSchema.parse({
    toolSequence,
    toolStatuses: groupByToolName(toolRecords, (record) => record.status),
    policyVerdicts: groupByToolName(toolRecords, (record) => record.policyVerdict?.status),
    evidence: evidence.map((record) => ({ id: record.id, type: record.type })),
    ...(run?.status ? { runStatus: run.status } : {}),
    outputKeys: collectOutputKeys(source.output),
    ...options,
    traceEventCount: events.length,
  });
}

export function compareReplayExpectation(
  expected: ReplayExpectation,
  source: ReplaySource,
): ReplayComparisonResult {
  const actual = createReplayExpectation(source);
  const failures: string[] = [];

  compareArray("tool sequence", expected.toolSequence, actual.toolSequence, failures);
  compareRecordArrays("tool statuses", expected.toolStatuses, actual.toolStatuses, failures);
  compareRecordArrays("policy verdicts", expected.policyVerdicts, actual.policyVerdicts, failures);
  compareEvidence(expected.evidence, actual.evidence, failures);
  compareOutputKeys(expected, actual.outputKeys, failures);

  if (expected.runStatus !== undefined && actual.runStatus !== expected.runStatus) {
    failures.push(
      `Expected run status "${expected.runStatus}", got "${actual.runStatus ?? "(none)"}".`,
    );
  }

  if (source.events !== undefined && actual.traceEventCount !== expected.traceEventCount) {
    failures.push(
      `Expected ${expected.traceEventCount} trace events from fixture, got ${actual.traceEventCount} current events.`,
    );
  }

  return { failures, actual };
}

function getSourceRun(source: ReplaySource): TraceGateRun | undefined {
  if (source.run) {
    return TraceGateRunSchema.parse(source.run);
  }

  const runEvent = source.events?.filter(isRunFinishedEvent).at(-1);
  return runEvent?.run;
}

function groupByToolName<T>(
  records: ToolCallRecord[],
  getValue: (record: ToolCallRecord) => T | undefined,
): Record<string, T[]> {
  const grouped: Record<string, T[]> = {};

  for (const record of records) {
    const value = getValue(record);
    if (value === undefined) {
      continue;
    }

    grouped[record.toolName] ??= [];
    grouped[record.toolName]?.push(value);
  }

  return grouped;
}

function collectOutputKeys(output: unknown): string[] {
  const keys: string[] = [];
  collectOutputKeysAtPath(output, "", keys, new WeakSet(), 0);
  return keys.sort();
}

function collectOutputKeysAtPath(
  value: unknown,
  prefix: string,
  keys: string[],
  seen: WeakSet<object>,
  depth: number,
): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return;
  }
  if (seen.has(value) || depth > 20) {
    return;
  }

  seen.add(value);

  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    keys.push(path);
    collectOutputKeysAtPath(child, path, keys, seen, depth + 1);
  }
}

function compareArray(
  label: string,
  expected: string[],
  actual: string[],
  failures: string[],
): void {
  if (
    expected.length !== actual.length ||
    expected.some((value, index) => value !== actual[index])
  ) {
    failures.push(`Expected ${label} ${formatList(expected)}, got ${formatList(actual)}.`);
  }
}

function compareRecordArrays(
  label: string,
  expected: Record<string, string[]>,
  actual: Record<string, string[]>,
  failures: string[],
): void {
  const keys = Array.from(new Set([...Object.keys(expected), ...Object.keys(actual)])).sort();

  for (const key of keys) {
    compareArray(`${label} for "${key}"`, expected[key] ?? [], actual[key] ?? [], failures);
  }
}

function compareEvidence(
  expected: ReplayExpectation["evidence"],
  actual: ReplayExpectation["evidence"],
  failures: string[],
): void {
  const expectedValues = expected.map((record) => `${record.id}:${record.type}`).sort();
  const actualValues = actual.map((record) => `${record.id}:${record.type}`).sort();
  compareArray("evidence", expectedValues, actualValues, failures);
}

function compareOutputKeys(
  expected: ReplayExpectation,
  actual: string[],
  failures: string[],
): void {
  const ignoredSet = new Set(expected.ignoredOutputKeys);
  const optionalSet = expandWithParentPaths(expected.optionalOutputKeys);
  const ignoredOrOptionalParentSet = expandWithParentPaths([
    ...expected.ignoredOutputKeys,
    ...expected.optionalOutputKeys,
  ]);
  const expectedComparable = expected.outputKeys.filter((key) => !ignoredSet.has(key));
  const expectedRequired = expectedComparable.filter(
    (key) => !optionalSet.has(key) && !ignoredOrOptionalParentSet.has(key),
  );
  const allowed = new Set([
    ...expectedComparable,
    ...expected.optionalOutputKeys,
    ...ignoredOrOptionalParentSet,
  ]);
  const actualComparable = actual.filter((key) => !ignoredSet.has(key));
  const actualSet = new Set(actualComparable);
  const missing = expectedRequired.filter((key) => !actualSet.has(key));
  const unexpected =
    expected.outputKeysMode === "exact" ? actualComparable.filter((key) => !allowed.has(key)) : [];

  if (missing.length === 0 && unexpected.length === 0) {
    return;
  }

  const modeNote =
    expected.outputKeysMode === "subset"
      ? "subset mode allows extra output keys"
      : "exact mode rejects extra output keys";
  failures.push(
    `Expected output keys ${formatList(expectedRequired)} (${modeNote}), got ${formatList(actualComparable)}. Missing: ${formatList(missing)}. Unexpected: ${formatList(unexpected)}. Ignored: ${formatList(expected.ignoredOutputKeys)}. Optional: ${formatList(expected.optionalOutputKeys)}.`,
  );
}

function expandWithParentPaths(paths: string[]): Set<string> {
  const expanded = new Set<string>();

  for (const path of paths) {
    const parts = path.split(".");
    for (let index = 1; index <= parts.length; index += 1) {
      expanded.add(parts.slice(0, index).join("."));
    }
  }

  return expanded;
}

function formatList(values: string[]): string {
  const limit = 20;
  if (values.length === 0) {
    return "[]";
  }
  const shown = values.slice(0, limit).join(", ");
  const suffix = values.length > limit ? `, ... +${values.length - limit} more` : "";
  return `[${shown}${suffix}]`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseTraceJsonlLine(line: string, lineNumber: number): TraceEvent | undefined {
  if (line.trim().length === 0) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    throw new Error(`Invalid JSONL trace row at line ${lineNumber}: ${getErrorMessage(error)}`);
  }

  try {
    return TraceEventSchema.parse(parsed);
  } catch (error) {
    throw new Error(
      `Invalid TraceGate trace event at line ${lineNumber}: ${getErrorMessage(error)}`,
    );
  }
}

function isToolEvent(event: TraceEvent): event is Extract<TraceEvent, { type: `tool.${string}` }> {
  return event.type.startsWith("tool.");
}

function isEvidenceEvent(
  event: TraceEvent,
): event is Extract<TraceEvent, { type: "evidence.recorded" }> {
  return event.type === "evidence.recorded";
}

function isRunFinishedEvent(event: TraceEvent): event is RunTraceEvent {
  return event.type === "run.finished";
}
