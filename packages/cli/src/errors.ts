import {
  type PolicyDiagnostic,
  type PolicyVerdict,
  summarizeSideEffectSafety,
  TraceGateRuntimeError,
} from "@tracegate/core";

const DETAIL_LIMIT = 5;

export function formatRunCaseError(error: unknown): string {
  if (error instanceof TraceGateRuntimeError || isTraceGateRuntimeErrorLike(error)) {
    const parts = [error.message];
    if (error.toolName) {
      parts.push(`tool=${error.toolName}`);
    }
    if (isPolicyVerdictLike(error.verdict)) {
      const verdict = error.verdict;
      parts.push(`verdict=${verdict.status}`);
      parts.push(`riskTier=${verdict.riskTier}`);
      if (verdict.reasons.length > 0) {
        parts.push(`reasons=${formatLimited(verdict.reasons)}`);
      }
      if (verdict.diagnostics && verdict.diagnostics.length > 0) {
        parts.push(`diagnostics=${formatPolicyDiagnostics(verdict.diagnostics)}`);
      }
      if (verdict.status === "block" || verdict.status === "review") {
        const sideEffectSafety = summarizeSideEffectSafety({
          toolName: verdict.toolName,
          status: "blocked",
          riskTier: verdict.riskTier,
          policyVerdict: verdict,
        });
        parts.push(`handlerExecuted=${sideEffectSafety.handlerExecuted}`);
        if (sideEffectSafety.handlerSkippedReason) {
          parts.push(`handlerSkippedReason=${sideEffectSafety.handlerSkippedReason}`);
        }
        parts.push(`sideEffectPrevented=${sideEffectSafety.sideEffectPrevented}`);
      }
    }
    if (error.cause !== undefined) {
      parts.push(`cause=${getErrorMessage(error.cause)}`);
    }
    return parts.join(" ");
  }

  return getErrorMessage(error);
}

function isTraceGateRuntimeErrorLike(error: unknown): error is {
  message: string;
  toolName?: string;
  verdict?: unknown;
  cause?: unknown;
} {
  return (
    error instanceof Error &&
    (error.name.startsWith("TraceGate") || "verdict" in error || "toolName" in error)
  );
}

function isPolicyVerdictLike(verdict: unknown): verdict is PolicyVerdict {
  if (verdict === null || typeof verdict !== "object") {
    return false;
  }
  const candidate = verdict as Partial<PolicyVerdict>;
  return (
    typeof candidate.status === "string" &&
    Array.isArray(candidate.reasons) &&
    candidate.reasons.every((reason) => typeof reason === "string") &&
    typeof candidate.riskTier === "string" &&
    typeof candidate.toolName === "string"
  );
}

export function formatPolicyDiagnostics(diagnostics: PolicyDiagnostic[]): string {
  return formatLimited(diagnostics.map(formatPolicyDiagnostic));
}

export function formatPolicyDiagnostic(diagnostic: PolicyDiagnostic): string {
  const approval = diagnostic.approval ? ` approval=${diagnostic.approval}` : "";
  return `${diagnostic.source}:${diagnostic.rule}: ${diagnostic.message}${approval}`;
}

export function formatLimited(values: string[]): string {
  const shown = values.slice(0, DETAIL_LIMIT).join(" | ");
  const suffix = values.length > DETAIL_LIMIT ? ` | +${values.length - DETAIL_LIMIT} more` : "";
  return `${shown}${suffix}`;
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
