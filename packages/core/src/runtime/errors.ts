import type { PolicyVerdict } from "../policy/verdict.js";

export interface TraceGateRuntimeErrorDetails {
  runId?: string;
  toolName?: string;
  verdict?: PolicyVerdict;
  cause?: unknown;
}

export class TraceGateRuntimeError extends Error {
  readonly runId: string | undefined;
  readonly toolName: string | undefined;
  readonly verdict: PolicyVerdict | undefined;

  constructor(message: string, details: TraceGateRuntimeErrorDetails = {}) {
    super(message, { cause: details.cause });
    this.name = new.target.name;
    this.runId = details.runId;
    this.toolName = details.toolName;
    this.verdict = details.verdict;
  }
}

export class TraceGateInputValidationError extends TraceGateRuntimeError {}

export class TraceGatePolicyBlockedError extends TraceGateRuntimeError {}

export class TraceGateReviewRequiredError extends TraceGateRuntimeError {}

export class TraceGateToolExecutionError extends TraceGateRuntimeError {}
