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
  runCase(input: TraceGateRunCaseInput): Promise<TraceGateRunnerResult> | TraceGateRunnerResult;
}

export function defineTraceGateConfig(config: {
  matrix: readonly MatrixCaseInput[];
  runCase(input: TraceGateRunCaseInput): Promise<TraceGateRunnerResult> | TraceGateRunnerResult;
}): TraceGateConfig {
  return normalizeTraceGateConfig(config);
}

export function normalizeTraceGateConfig(value: unknown): TraceGateConfig {
  if (typeof value !== "object" || value === null) {
    throw new Error("TraceGate config must export an object.");
  }

  const candidate = value as {
    matrix?: unknown;
    runCase?: unknown;
  };

  if (typeof candidate.runCase !== "function") {
    throw new Error("TraceGate config must define a runCase function.");
  }

  return {
    matrix: defineMatrix(candidate.matrix as readonly MatrixCaseInput[]),
    runCase: candidate.runCase as TraceGateConfig["runCase"],
  };
}
