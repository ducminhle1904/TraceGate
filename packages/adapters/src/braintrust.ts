import type {
  JsonObject,
  JsonValue,
  ReplayComparisonResult,
  ReplayExpectation,
  TraceEvent,
  TraceGateRun,
} from "@tracegate/core";
import { createReplayExpectation, summarizeReplaySource } from "@tracegate/core";

export interface BraintrustEvalRow {
  input: JsonObject;
  expected?: JsonValue;
  output?: JsonValue;
  scores?: JsonObject;
  metadata: JsonObject;
}

export interface BraintrustMatrixCaseResult {
  id: string;
  status: "passed" | "failed";
  durationMs: number;
  failures: string[];
  outputSummary?: string;
  runId?: string;
  traceEventCount: number;
}

export interface BraintrustMatrixReport {
  version: string;
  status: "passed" | "failed";
  counts: {
    total: number;
    passed: number;
    failed: number;
  };
  cases: BraintrustMatrixCaseResult[];
}

export interface BraintrustReplayInput {
  id?: string;
  caseId?: string;
  events?: TraceEvent[];
  run?: TraceGateRun;
  output?: unknown;
  expected?: ReplayExpectation;
  comparison?: ReplayComparisonResult;
  failures?: string[];
  metadata?: JsonObject;
}

export type BraintrustEvalRowsInput =
  | BraintrustMatrixReport
  | BraintrustMatrixCaseResult[]
  | BraintrustReplayInput;

export function toBraintrustEvalRows(input: BraintrustEvalRowsInput): BraintrustEvalRow[] {
  if (Array.isArray(input)) {
    return input.map(matrixCaseResultToRow);
  }

  if (isMatrixReport(input)) {
    return input.cases.map(matrixCaseResultToRow);
  }

  return [replayInputToRow(input)];
}

function matrixCaseResultToRow(result: BraintrustMatrixCaseResult): BraintrustEvalRow {
  return {
    input: { caseId: result.id },
    output: {
      status: result.status,
      outputSummary: result.outputSummary ?? null,
    },
    scores: {
      passed: result.status === "passed" ? 1 : 0,
      failureCount: result.failures.length,
    },
    metadata: {
      kind: "tracegate.matrix.case",
      durationMs: result.durationMs,
      failures: result.failures,
      runId: result.runId ?? null,
      traceEventCount: result.traceEventCount,
    },
  };
}

function replayInputToRow(input: BraintrustReplayInput): BraintrustEvalRow {
  const actual = input.comparison?.actual ?? createReplayExpectation(input);
  const summary = summarizeReplaySource(input);
  const failures = input.comparison?.failures ?? input.failures ?? [];

  return {
    input: {
      caseId: input.caseId ?? input.id ?? summary.runId ?? "tracegate-replay",
    },
    expected: sanitizeJson(input.expected ?? null),
    output: sanitizeJson(actual),
    scores: {
      passed: failures.length === 0 ? 1 : 0,
      failureCount: failures.length,
    },
    metadata: cleanJsonObject({
      kind: "tracegate.replay",
      ...summary,
      failures,
      ...(input.metadata ?? {}),
    }),
  };
}

function isMatrixReport(input: BraintrustEvalRowsInput): input is BraintrustMatrixReport {
  return !Array.isArray(input) && "cases" in input && Array.isArray(input.cases);
}

function sanitizeJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function cleanJsonObject(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}
