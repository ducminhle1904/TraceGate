import type { MatrixCase, MatrixCaseInput, TraceEvent, TraceGateRun } from "@tracegate/core";
import { defineMatrix } from "@tracegate/core";

export interface TraceGateRunCaseInput {
  case: MatrixCase;
  index: number;
}

export interface TraceGateRunnerResult {
  events?: TraceEvent[];
  run?: TraceGateRun;
  output?: unknown;
  metadata?: Record<string, unknown>;
}

export interface TraceGateConfig {
  matrix: MatrixCase[];
  concurrency?: number;
  runCase(input: TraceGateRunCaseInput): Promise<TraceGateRunnerResult> | TraceGateRunnerResult;
}

export function defineTraceGateConfig(config: {
  matrix: readonly MatrixCaseInput[];
  concurrency?: number;
  runCase(input: TraceGateRunCaseInput): Promise<TraceGateRunnerResult> | TraceGateRunnerResult;
}): TraceGateConfig {
  return normalizeTraceGateConfig(config);
}

export function normalizeTraceGateConfig(value: unknown): TraceGateConfig {
  if (typeof value !== "object" || value === null) {
    throw new Error("TraceGate config must export an object.");
  }

  const candidate = value as {
    concurrency?: unknown;
    matrix?: unknown;
    runCase?: unknown;
  };

  if (typeof candidate.runCase !== "function") {
    throw new Error("TraceGate config must define a runCase function.");
  }

  const concurrency = normalizeConcurrency(candidate.concurrency);

  return {
    matrix: defineMatrix(candidate.matrix as readonly MatrixCaseInput[]),
    ...(concurrency ? { concurrency } : {}),
    runCase: candidate.runCase as TraceGateConfig["runCase"],
  };
}

function normalizeConcurrency(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error("TraceGate config concurrency must be an integer greater than or equal to 1.");
  }

  return value;
}
