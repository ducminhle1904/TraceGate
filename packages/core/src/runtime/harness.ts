import type { EvidenceRecord, EvidenceRecordInput } from "../evidence/evidence.js";
import { createEvidenceRecord } from "../evidence/evidence.js";
import type { ApprovalState, EvaluatePolicyInput } from "../policy/evaluate-policy.js";
import { evaluatePolicy } from "../policy/evaluate-policy.js";
import type { PolicyVerdict } from "../policy/verdict.js";
import type { RedactValueOptions } from "../redaction/redact.js";
import type { JsonObject } from "../schema/json.js";
import type { HarnessContext, HarnessSurface } from "../schema/surface.js";
import { HarnessContextSchema, HarnessSurfaceSchema } from "../schema/surface.js";
import type {
  InferToolInput,
  InferToolOutput,
  ToolContract,
  TraceGateInputSchema,
} from "../schema/tool-contract.js";
import type { ToolCallRecord, TraceGateRun, TraceGateRunStatus } from "../schema/trace.js";
import { TraceGateRunSchema, TraceGateRunStatusSchema } from "../schema/trace.js";
import { appendPolicyDiagnostic, resolvePolicyVerdictAfterReview } from "./approval-resolution.js";
import {
  TraceGateInputValidationError,
  TraceGatePolicyBlockedError,
  TraceGateReviewRequiredError,
  TraceGateToolExecutionError,
} from "./errors.js";
import {
  createId,
  createToolCallRecord,
  nowIso,
  type ToolCallRecordInput,
  toJsonCompatible,
  toJsonValue,
} from "./tool-record.js";
import {
  createMemoryTraceSink,
  type TraceEvent,
  type TraceEventInput,
  type TraceSink,
} from "./trace-sink.js";

export interface CreateHarnessOptions {
  surface?: HarnessSurface | string;
  context?: HarnessContext;
  traceSink?: TraceSink;
  policyEvaluator?: PolicyEvaluator;
  approvalHandler?: ApprovalHandler;
  redaction?: RedactValueOptions;
}

export interface StartRunInput {
  id?: string;
  surface?: HarnessSurface | string;
  context?: HarnessContext;
  metadata?: JsonObject;
}

export interface ToolRuntimeContext {
  run: TraceGateRun;
  runId: string;
  context: HarnessContext;
  contract: ToolContract;
  verdict: PolicyVerdict;
  recordEvidence(record: EvidenceRecordInput): Promise<EvidenceRecord>;
}

export type ApprovalHandlerResult =
  | ApprovalState
  | {
      status: ApprovalState;
      reason?: string;
      metadata?: JsonObject;
    };

export type ApprovalHandler = (input: {
  contract: ToolContract;
  input: unknown;
  context: HarnessContext;
  verdict: PolicyVerdict;
}) => ApprovalHandlerResult | Promise<ApprovalHandlerResult>;

export type PolicyEvaluator = (
  input: EvaluatePolicyInput,
) => PolicyVerdict | Promise<PolicyVerdict>;

export type WrappedTool<TInputSchema extends TraceGateInputSchema, TResult> = (
  input: InferToolInput<TInputSchema>,
) => Promise<TResult>;

export interface Harness {
  readonly traceSink: TraceSink;
  startRun(input?: StartRunInput): Promise<TraceGateRun>;
  finishRun(status?: TraceGateRunStatus): Promise<TraceGateRun>;
  recordEvidence(record: EvidenceRecordInput): Promise<EvidenceRecord>;
  wrapTool<TInputSchema extends TraceGateInputSchema, TResult>(
    contract: ToolContract<TInputSchema>,
    execute: (
      input: InferToolOutput<TInputSchema>,
      context: ToolRuntimeContext,
    ) => Promise<TResult> | TResult,
  ): WrappedTool<TInputSchema, TResult>;
}

export function createHarness(options: CreateHarnessOptions = {}): Harness {
  const traceSink = options.traceSink ?? createMemoryTraceSink();
  const policyEvaluator = options.policyEvaluator ?? evaluatePolicy;
  const baseSurface = normalizeSurface(options.surface);
  const baseContext = HarnessContextSchema.parse({
    ...(options.context ?? {}),
    ...(baseSurface ? { surface: baseSurface } : {}),
  });
  const redaction = options.redaction;
  let sequence = 0;
  let activeRun: TraceGateRun | undefined;
  let writeQueue: Promise<void> = Promise.resolve();

  const writeEvent = async (event: TraceEventInput): Promise<void> => {
    sequence += 1;
    const nextEvent: TraceEvent = { sequence, ...event };
    const writeOperation = writeQueue.then(() => traceSink.write(nextEvent));
    writeQueue = writeOperation.catch(() => undefined);
    await writeOperation;
  };

  const ensureRun = async (): Promise<TraceGateRun> =>
    activeRun?.status === "running" ? activeRun : startRun();

  const startRun = async (input: StartRunInput = {}): Promise<TraceGateRun> => {
    const surface = normalizeSurface(input.surface) ?? baseSurface;
    const context = HarnessContextSchema.parse({
      ...baseContext,
      ...(input.context ?? {}),
      ...(surface ? { surface } : {}),
    });

    const run = TraceGateRunSchema.parse({
      id: input.id ?? createId("run"),
      surface,
      context,
      startedAt: nowIso(),
      status: "running",
      toolCalls: [],
      evidence: [],
      metadata: input.metadata,
    });

    activeRun = run;
    await writeEvent({
      type: "run.started",
      timestamp: run.startedAt,
      runId: run.id,
      run,
    });

    return run;
  };

  const finishRun = async (status: TraceGateRunStatus = "succeeded"): Promise<TraceGateRun> => {
    const run = await ensureRun();
    const finished = TraceGateRunSchema.parse({
      ...run,
      status: TraceGateRunStatusSchema.parse(status),
      finishedAt: nowIso(),
    });

    await writeEvent({
      type: "run.finished",
      timestamp: finished.finishedAt ?? nowIso(),
      runId: finished.id,
      run: finished,
    });
    await traceSink.flush?.();
    activeRun = undefined;

    return finished;
  };

  const recordEvidence = async (record: EvidenceRecordInput): Promise<EvidenceRecord> => {
    const run = await ensureRun();
    return recordEvidenceForRun(run, record);
  };

  const recordEvidenceForRun = async (
    run: TraceGateRun,
    record: EvidenceRecordInput,
  ): Promise<EvidenceRecord> => {
    const parsed = createEvidenceRecord(record, { now: nowIso });
    run.evidence.push(parsed);
    await writeEvent({
      type: "evidence.recorded",
      timestamp: parsed.timestamp,
      runId: run.id,
      record: parsed,
    });
    return parsed;
  };

  const wrapTool = <TInputSchema extends TraceGateInputSchema, TResult>(
    contract: ToolContract<TInputSchema>,
    execute: (
      input: InferToolOutput<TInputSchema>,
      context: ToolRuntimeContext,
    ) => Promise<TResult> | TResult,
  ): WrappedTool<TInputSchema, TResult> => {
    return async (input: InferToolInput<TInputSchema>): Promise<TResult> => {
      const run = await ensureRun();
      const parsedInput = contract.inputSchema.safeParse(input);

      if (!parsedInput.success) {
        const redactedInput = toJsonValue(input, redaction);
        await recordToolEvent(run, "tool.blocked", {
          toolName: contract.name,
          riskTier: contract.riskTier,
          status: "blocked",
          input: redactedInput,
          error: getErrorMessage(parsedInput.error),
        });
        throw new TraceGateInputValidationError("Tool input failed contract validation.", {
          runId: run.id,
          toolName: contract.name,
          cause: parsedInput.error,
        });
      }

      const initialVerdict = await policyEvaluator({
        contract,
        approval: "missing",
        context: getRunContext(run),
        environment: getRunEnvironment(run),
        evidence: run.evidence,
        input: parsedInput.data,
      });
      const verdict = await resolveVerdict(contract, parsedInput.data, run, initialVerdict);
      const redactedInput = toJsonValue(parsedInput.data, redaction);

      if (verdict.status === "block") {
        const blockedVerdict = appendPolicyDiagnostic(verdict, {
          source: "runtime",
          rule: "execution-skipped",
          message: "Tool was not executed because the policy verdict was block.",
          riskTier: contract.riskTier,
        });
        await recordToolEvent(run, "tool.blocked", {
          toolName: contract.name,
          riskTier: contract.riskTier,
          status: "blocked",
          input: redactedInput,
          policyVerdict: blockedVerdict,
          error: blockedVerdict.reasons.join("; "),
        });
        throw new TraceGatePolicyBlockedError("Tool call blocked by TraceGate policy.", {
          runId: run.id,
          toolName: contract.name,
          verdict: blockedVerdict,
        });
      }

      if (verdict.status === "review") {
        const reviewVerdict = appendPolicyDiagnostic(verdict, {
          source: "runtime",
          rule: "execution-skipped",
          message: "Tool was not executed because the policy verdict was review.",
          riskTier: contract.riskTier,
        });
        await recordToolEvent(run, "tool.blocked", {
          toolName: contract.name,
          riskTier: contract.riskTier,
          status: "blocked",
          input: redactedInput,
          policyVerdict: reviewVerdict,
          error: reviewVerdict.reasons.join("; "),
        });
        throw new TraceGateReviewRequiredError("Tool call requires review before execution.", {
          runId: run.id,
          toolName: contract.name,
          verdict: reviewVerdict,
        });
      }

      await recordToolEvent(run, "tool.started", {
        toolName: contract.name,
        riskTier: contract.riskTier,
        status: "started",
        input: redactedInput,
        policyVerdict: verdict,
      });

      let result: TResult;
      try {
        result = await execute(parsedInput.data as InferToolOutput<TInputSchema>, {
          run: snapshotRun(run),
          runId: run.id,
          context: getRunContext(run),
          contract,
          verdict,
          recordEvidence: (record) => recordEvidenceForRun(run, record),
        });
      } catch (error) {
        await recordToolEvent(run, "tool.failed", {
          toolName: contract.name,
          riskTier: contract.riskTier,
          status: "failed",
          input: redactedInput,
          error: getErrorMessage(error),
          policyVerdict: verdict,
        });
        throw new TraceGateToolExecutionError("Tool execution failed.", {
          runId: run.id,
          toolName: contract.name,
          verdict,
          cause: error,
        });
      }

      await recordToolEvent(run, "tool.succeeded", {
        toolName: contract.name,
        riskTier: contract.riskTier,
        status: "succeeded",
        input: redactedInput,
        output: result,
        policyVerdict: verdict,
      });
      return result;
    };
  };

  const resolveVerdict = async (
    contract: ToolContract,
    input: unknown,
    run: TraceGateRun,
    initialVerdict: PolicyVerdict,
  ): Promise<PolicyVerdict> => {
    const context = getRunContext(run);
    return resolvePolicyVerdictAfterReview({
      contract,
      input,
      context,
      initialVerdict,
      approvalHandler: options.approvalHandler,
      evaluateWithApproval: (approval) =>
        policyEvaluator({
          contract,
          context,
          approval,
          environment: getRunEnvironment(run),
          evidence: run.evidence,
          input,
        }),
    });
  };

  const recordToolEvent = async (
    run: TraceGateRun,
    type: Extract<TraceEvent["type"], `tool.${string}`>,
    input: ToolCallRecordInput,
  ): Promise<ToolCallRecord> => {
    const { record, timestamp } = createToolCallRecord({
      runId: run.id,
      redaction,
      record: input,
    });

    run.toolCalls.push(record);
    await writeEvent({
      type,
      timestamp,
      runId: run.id,
      record,
    });
    return record;
  };

  return {
    traceSink,
    startRun,
    finishRun,
    recordEvidence,
    wrapTool,
  };
}

function normalizeSurface(
  surface: HarnessSurface | string | undefined,
): HarnessSurface | undefined {
  if (typeof surface === "string") {
    return HarnessSurfaceSchema.parse({ id: surface });
  }

  return surface === undefined ? undefined : HarnessSurfaceSchema.parse(surface);
}

function getRunContext(run: TraceGateRun): HarnessContext {
  return run.context ?? {};
}

function getRunEnvironment(run: TraceGateRun) {
  return run.surface?.environment ?? run.context?.surface?.environment;
}

function snapshotRun(run: TraceGateRun): TraceGateRun {
  return TraceGateRunSchema.parse(toJsonCompatible(run));
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
