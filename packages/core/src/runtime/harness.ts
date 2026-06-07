import type { z } from "zod";

import type { EvidenceRecord, EvidenceRecordInput } from "../evidence/evidence.js";
import { EvidenceRecordSchema } from "../evidence/evidence.js";
import type { ApprovalState, EvaluatePolicyInput } from "../policy/evaluate-policy.js";
import { evaluatePolicy } from "../policy/evaluate-policy.js";
import type { PolicyVerdict } from "../policy/verdict.js";
import { type RedactValueOptions, redactValue } from "../redaction/redact.js";
import type { JsonObject, JsonValue } from "../schema/json.js";
import { JsonObjectSchema, JsonValueSchema } from "../schema/json.js";
import type { HarnessContext, HarnessSurface } from "../schema/surface.js";
import { HarnessContextSchema, HarnessSurfaceSchema } from "../schema/surface.js";
import type { ToolContract } from "../schema/tool-contract.js";
import type { ToolCallRecord, TraceGateRun, TraceGateRunStatus } from "../schema/trace.js";
import {
  ToolCallRecordSchema,
  TraceGateRunSchema,
  TraceGateRunStatusSchema,
} from "../schema/trace.js";
import {
  TraceGateInputValidationError,
  TraceGatePolicyBlockedError,
  TraceGateReviewRequiredError,
  TraceGateToolExecutionError,
} from "./errors.js";
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

export type ApprovalHandler = (input: {
  contract: ToolContract;
  input: unknown;
  context: HarnessContext;
  verdict: PolicyVerdict;
}) => ApprovalState | Promise<ApprovalState>;

export type PolicyEvaluator = (
  input: EvaluatePolicyInput,
) => PolicyVerdict | Promise<PolicyVerdict>;

export type WrappedTool<TInputSchema extends z.ZodType<unknown>, TResult> = (
  input: z.input<TInputSchema>,
) => Promise<TResult>;

export interface Harness {
  readonly traceSink: TraceSink;
  startRun(input?: StartRunInput): Promise<TraceGateRun>;
  finishRun(status?: TraceGateRunStatus): Promise<TraceGateRun>;
  recordEvidence(record: EvidenceRecordInput): Promise<EvidenceRecord>;
  wrapTool<TInputSchema extends z.ZodType<unknown>, TResult>(
    contract: ToolContract<TInputSchema>,
    execute: (
      input: z.infer<TInputSchema>,
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
    const parsed = EvidenceRecordSchema.parse(record);
    run.evidence.push(parsed);
    await writeEvent({
      type: "evidence.recorded",
      timestamp: parsed.timestamp,
      runId: run.id,
      record: parsed,
    });
    return parsed;
  };

  const wrapTool = <TInputSchema extends z.ZodType<unknown>, TResult>(
    contract: ToolContract<TInputSchema>,
    execute: (
      input: z.infer<TInputSchema>,
      context: ToolRuntimeContext,
    ) => Promise<TResult> | TResult,
  ): WrappedTool<TInputSchema, TResult> => {
    return async (input: z.input<TInputSchema>): Promise<TResult> => {
      const run = await ensureRun();
      const parsedInput = contract.inputSchema.safeParse(input);

      if (!parsedInput.success) {
        const redactedInput = toJsonValue(input);
        await recordToolEvent(run, "tool.blocked", {
          toolName: contract.name,
          riskTier: contract.riskTier,
          status: "blocked",
          input: redactedInput,
          error: parsedInput.error.message,
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
      const redactedInput = toJsonValue(parsedInput.data);

      if (verdict.status === "block") {
        await recordToolEvent(run, "tool.blocked", {
          toolName: contract.name,
          riskTier: contract.riskTier,
          status: "blocked",
          input: redactedInput,
          policyVerdict: verdict,
          error: verdict.reasons.join("; "),
        });
        throw new TraceGatePolicyBlockedError("Tool call blocked by TraceGate policy.", {
          runId: run.id,
          toolName: contract.name,
          verdict,
        });
      }

      if (verdict.status === "review") {
        await recordToolEvent(run, "tool.blocked", {
          toolName: contract.name,
          riskTier: contract.riskTier,
          status: "blocked",
          input: redactedInput,
          policyVerdict: verdict,
          error: verdict.reasons.join("; "),
        });
        throw new TraceGateReviewRequiredError("Tool call requires review before execution.", {
          runId: run.id,
          toolName: contract.name,
          verdict,
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
        result = await execute(parsedInput.data as z.output<TInputSchema>, {
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
    if (initialVerdict.status !== "review") {
      return initialVerdict;
    }

    const approval = await options.approvalHandler?.({
      contract,
      input,
      context,
      verdict: initialVerdict,
    });

    if (approval === undefined || approval === "missing") {
      return initialVerdict;
    }

    return policyEvaluator({
      contract,
      approval,
      context,
      environment: getRunEnvironment(run),
      evidence: run.evidence,
      input,
    });
  };

  const recordToolEvent = async (
    run: TraceGateRun,
    type: Extract<TraceEvent["type"], `tool.${string}`>,
    input: Omit<ToolCallRecord, "id" | "runId" | "timestamp" | "input" | "output" | "metadata"> & {
      input?: JsonValue | undefined;
      output?: unknown;
      metadata?: unknown;
    },
  ): Promise<ToolCallRecord> => {
    const timestamp = nowIso();
    const { input: toolInput, output: toolOutput, metadata: toolMetadata, ...recordInput } = input;
    const record = ToolCallRecordSchema.parse({
      ...recordInput,
      id: createId("tool"),
      runId: run.id,
      timestamp,
      ...(toolInput !== undefined ? { input: toolInput } : {}),
      ...(toolOutput !== undefined ? { output: toJsonValue(toolOutput) } : {}),
      ...(toolMetadata !== undefined ? { metadata: toJsonObject(toolMetadata) } : {}),
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

  const toJsonValue = (value: unknown): JsonValue | undefined => {
    if (value === undefined) {
      return undefined;
    }

    const redacted = redactValue(value, redaction);
    const serialized = toJsonCompatible(redacted);
    return JsonValueSchema.parse(serialized);
  };

  const toJsonObject = (value: unknown): JsonObject | undefined => {
    if (value === undefined) {
      return undefined;
    }

    const redacted = redactValue(value, redaction);
    const serialized = toJsonCompatible(redacted);
    return JsonObjectSchema.parse(serialized);
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

function nowIso(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
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

function toJsonCompatible(value: unknown): unknown {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? String(value) : JSON.parse(serialized);
  } catch {
    return "[UNSERIALIZABLE]";
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
