import type {
  EvidenceRecord,
  JsonObject,
  MatrixCase,
  PolicyVerdictStatus,
  RunTraceEvent,
  ToolCallRecord,
  TraceEvent,
} from "@tracegate/core";

import type { TraceGateRunnerResult } from "./config.js";

export interface MatrixAssertionInput {
  case: MatrixCase;
  result: TraceGateRunnerResult;
}

export interface MatrixAssertionResult {
  failures: string[];
  runId?: string;
  traceEventCount: number;
}

interface ActualRecords {
  toolRecords: ToolCallRecord[];
  startedTools: string[];
  evidenceRecords: EvidenceRecord[];
  evidenceTexts: string[];
  runId?: string;
  traceEventCount: number;
}

export function evaluateMatrixAssertions(input: MatrixAssertionInput): MatrixAssertionResult {
  const actual = collectActualRecords(input.result);
  const failures: string[] = [];
  const expectations = input.case.expect;

  for (const toolName of expectations.requiredTools ?? []) {
    if (!actual.toolRecords.some((record) => record.toolName === toolName)) {
      failures.push(`Expected tool "${toolName}" to be called.`);
    }
  }

  for (const toolName of expectations.forbiddenTools ?? []) {
    if (actual.toolRecords.some((record) => record.toolName === toolName)) {
      failures.push(`Expected tool "${toolName}" not to be called.`);
    }
  }

  if (expectations.orderedToolSequence) {
    const sequenceFailure = compareOrderedSequence(
      expectations.orderedToolSequence,
      actual.startedTools,
    );
    if (sequenceFailure) {
      failures.push(sequenceFailure);
    }
  }

  if (expectations.requiredPolicyVerdict) {
    const verdictFailure = requirePolicyVerdict(
      expectations.requiredPolicyVerdict,
      actual.toolRecords,
    );
    if (verdictFailure) {
      failures.push(verdictFailure);
    }
  }

  for (const requiredEvidence of expectations.requiredEvidence ?? []) {
    if (!actual.evidenceTexts.some((text) => text.includes(requiredEvidence))) {
      failures.push(`Expected evidence matching "${requiredEvidence}".`);
    }
  }

  for (const outputKey of expectations.outputKeys ?? []) {
    if (!hasPath(input.result.output, outputKey)) {
      failures.push(`Expected output key "${outputKey}".`);
    }
  }

  const traceText =
    expectations.redactionChecks && expectations.redactionChecks.length > 0
      ? JSON.stringify({ events: input.result.events, run: input.result.run })
      : "";
  for (const forbiddenValue of expectations.redactionChecks ?? []) {
    if (traceText.includes(forbiddenValue)) {
      failures.push(`Expected redaction check "${forbiddenValue}" to be absent from traces.`);
    }
  }

  for (const [toolName, expectedInput] of Object.entries(expectations.toolInputIncludes ?? {})) {
    if (!toolInputIncludes(actual.toolRecords, toolName, expectedInput)) {
      failures.push(
        `Expected tool "${toolName}" input to include ${JSON.stringify(expectedInput)}.`,
      );
    }
  }

  return {
    failures,
    traceEventCount: actual.traceEventCount,
    ...(actual.runId ? { runId: actual.runId } : {}),
  };
}

function collectActualRecords(result: TraceGateRunnerResult): ActualRecords {
  const events = result.events ?? [];
  const toolEvents = events.filter(isToolEvent);
  const evidenceEvents = events.filter(isEvidenceEvent);
  const run = result.run ?? events.filter(isRunFinishedEvent).at(-1)?.run;
  const toolRecords = run?.toolCalls ?? toolEvents.map((event) => event.record);
  const evidenceRecords = run?.evidence ?? evidenceEvents.map((event) => event.record);
  const runId = run?.id ?? events[0]?.runId;
  const startedTools =
    toolEvents.length > 0
      ? toolEvents
          .filter((event) => event.type === "tool.started")
          .map((event) => event.record.toolName)
      : toolRecords
          .filter((record) => record.status === "started")
          .map((record) => record.toolName);

  return {
    toolRecords,
    startedTools,
    evidenceRecords,
    evidenceTexts: evidenceRecords.map(evidenceToSearchText),
    traceEventCount: events.length,
    ...(runId ? { runId } : {}),
  };
}

function compareOrderedSequence(expected: string[], actual: string[]): string | undefined {
  let cursor = 0;
  for (const toolName of actual) {
    if (toolName === expected[cursor]) {
      cursor += 1;
    }
  }

  if (cursor === expected.length) {
    return undefined;
  }

  return `Expected tool order ${expected.join(" -> ")}, got ${actual.join(" -> ") || "(none)"}.`;
}

function requirePolicyVerdict(
  expected: PolicyVerdictStatus,
  records: ToolCallRecord[],
): string | undefined {
  const actual = records
    .map((record) => record.policyVerdict?.status)
    .filter((status): status is PolicyVerdictStatus => status !== undefined);

  if (actual.includes(expected)) {
    return undefined;
  }

  return `Expected policy verdict "${expected}", got ${actual.join(", ") || "(none)"}.`;
}

function evidenceToSearchText(record: EvidenceRecord): string {
  return JSON.stringify({
    id: record.id,
    type: record.type,
    source: record.source,
    content: record.content,
    metadata: record.metadata,
  });
}

function toolInputIncludes(
  records: ToolCallRecord[],
  toolName: string,
  expectedInput: JsonObject,
): boolean {
  return records
    .filter((record) => record.toolName === toolName)
    .some((record) => isPartialMatch(record.input, expectedInput));
}

function isPartialMatch(actual: unknown, expected: unknown): boolean {
  if (expected === null || typeof expected !== "object") {
    return Object.is(actual, expected);
  }

  if (actual === null || typeof actual !== "object") {
    return false;
  }

  if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      expected.every((value, index) => isPartialMatch(actual[index], value))
    );
  }

  return Object.entries(expected).every(([key, value]) =>
    isPartialMatch((actual as Record<string, unknown>)[key], value),
  );
}

function hasPath(value: unknown, path: string): boolean {
  if (value === null || typeof value !== "object") {
    return false;
  }

  let cursor: unknown = value;
  for (const segment of path.split(".")) {
    if (cursor === null || typeof cursor !== "object" || !(segment in cursor)) {
      return false;
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }

  return true;
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
