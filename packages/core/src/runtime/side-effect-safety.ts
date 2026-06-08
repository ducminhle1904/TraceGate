import type { PolicyDiagnostic, PolicyVerdict, PolicyVerdictStatus } from "../policy/verdict.js";
import type { RiskTier } from "../schema/tool-contract.js";
import type { ToolCallRecord } from "../schema/trace.js";
import type { RuntimeGateSummary } from "./runtime-gate.js";
import type { ToolTraceEvent } from "./trace-sink.js";

export type HandlerSkippedReason =
  | "validation-failed"
  | "policy-blocked"
  | "review-required"
  | "approval-denied"
  | "shadow-mismatch"
  | "allowlist-bypass"
  | "mode-off";

export interface SideEffectSafetySummary {
  handlerExecuted: boolean;
  handlerSkippedReason?: HandlerSkippedReason | undefined;
  sideEffectPrevented: boolean;
  wouldHaveExecutedInShadow?: boolean | undefined;
  toolName?: string | undefined;
  riskTier?: RiskTier | undefined;
  finalVerdict?: PolicyVerdictStatus | undefined;
  diagnosticRules: string[];
}

export function summarizeSideEffectSafety(input: unknown): SideEffectSafetySummary {
  if (isRuntimeGateSummary(input)) {
    return {
      handlerExecuted: input.handlerExecuted,
      ...(input.handlerSkippedReason ? { handlerSkippedReason: input.handlerSkippedReason } : {}),
      sideEffectPrevented: input.sideEffectPrevented,
      ...(input.wouldHaveExecutedInShadow !== undefined
        ? { wouldHaveExecutedInShadow: input.wouldHaveExecutedInShadow }
        : {}),
      toolName: input.toolName,
      riskTier: input.riskTier,
      finalVerdict: input.finalVerdict?.status,
      diagnosticRules: input.diagnostics.map(formatDiagnosticRule),
    };
  }

  const record = getToolRecord(input);
  if (record) {
    const handlerExecuted = record.status !== "blocked";
    const handlerSkippedReason = handlerExecuted
      ? undefined
      : inferHandlerSkippedReason({
          verdict: record.policyVerdict,
          validationFailed: record.policyVerdict === undefined,
        });
    return {
      handlerExecuted,
      ...(handlerSkippedReason ? { handlerSkippedReason } : {}),
      sideEffectPrevented: !handlerExecuted,
      toolName: record.toolName,
      riskTier: record.riskTier,
      finalVerdict: record.policyVerdict?.status,
      diagnosticRules: (record.policyVerdict?.diagnostics ?? []).map(formatDiagnosticRule),
    };
  }

  return {
    handlerExecuted: false,
    sideEffectPrevented: false,
    diagnosticRules: [],
  };
}

export function inferHandlerSkippedReason(input: {
  verdict?: PolicyVerdict | undefined;
  validationFailed?: boolean | undefined;
}): HandlerSkippedReason {
  if (input.validationFailed) {
    return "validation-failed";
  }
  if (hasDiagnosticRule(input.verdict?.diagnostics, "approval-denied")) {
    return "approval-denied";
  }
  if (input.verdict?.status === "review") {
    return "review-required";
  }
  return "policy-blocked";
}

export function traceGateWouldExecute(
  status: PolicyVerdictStatus | undefined,
): boolean | undefined {
  if (status === undefined) {
    return undefined;
  }
  return status === "allow" || status === "warn";
}

function isRuntimeGateSummary(value: unknown): value is RuntimeGateSummary {
  return (
    isRecord(value) &&
    typeof value.handlerExecuted === "boolean" &&
    typeof value.sideEffectPrevented === "boolean" &&
    typeof value.toolName === "string" &&
    typeof value.riskTier === "string" &&
    Array.isArray(value.diagnostics)
  );
}

function getToolRecord(value: unknown): ToolCallRecord | undefined {
  if (isRecord(value) && isRecord(value.record) && typeof value.type === "string") {
    return (value as unknown as ToolTraceEvent).record;
  }
  if (isRecord(value) && typeof value.toolName === "string" && typeof value.status === "string") {
    return value as ToolCallRecord;
  }
  return undefined;
}

function hasDiagnosticRule(diagnostics: PolicyDiagnostic[] | undefined, rule: string): boolean {
  return diagnostics?.some((diagnostic) => diagnostic.rule === rule) === true;
}

function formatDiagnosticRule(diagnostic: PolicyDiagnostic): string {
  return `${diagnostic.source}:${diagnostic.rule}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
