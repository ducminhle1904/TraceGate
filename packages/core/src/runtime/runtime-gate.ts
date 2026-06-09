import type { EvidenceRecord } from "../evidence/evidence.js";
import { evaluatePolicy } from "../policy/evaluate-policy.js";
import type { PolicyDiagnostic, PolicyVerdict, PolicyVerdictStatus } from "../policy/verdict.js";
import {
  detectSecretLikeValues,
  type RedactValueOptions,
  redactValue,
} from "../redaction/redact.js";
import type { JsonObject, JsonValue } from "../schema/json.js";
import type { HarnessContext } from "../schema/surface.js";
import { HarnessContextSchema } from "../schema/surface.js";
import type {
  InferToolInput,
  InferToolOutput,
  RiskTier,
  ToolContract,
  ToolSideEffectClass,
  TraceGateInputSchema,
} from "../schema/tool-contract.js";
import type { ToolCallRecord, ToolCallStatus, TraceGateRunStatus } from "../schema/trace.js";
import { appendPolicyDiagnostic, resolvePolicyVerdictAfterReview } from "./approval-resolution.js";
import {
  TraceGateInputValidationError,
  TraceGatePolicyBlockedError,
  TraceGateReviewRequiredError,
  TraceGateToolExecutionError,
} from "./errors.js";
import type { ApprovalHandler, PolicyEvaluator } from "./harness.js";
import {
  type HandlerSkippedReason,
  inferHandlerSkippedReason,
  traceGateWouldExecute,
} from "./side-effect-safety.js";
import {
  createId,
  createToolCallRecord,
  nowIso,
  toJsonObject,
  toJsonValue,
} from "./tool-record.js";
import type {
  EvidenceTraceEvent,
  RunTraceEvent,
  ToolTraceEvent,
  TraceEvent,
  TraceSink,
} from "./trace-sink.js";

export type RuntimeGateMode = "off" | "observe" | "shadow" | "enforce";
type RuntimeGateTraceEventInput =
  | Omit<RunTraceEvent, "sequence">
  | Omit<ToolTraceEvent, "sequence">
  | Omit<EvidenceTraceEvent, "sequence">;

export interface RuntimeGateEnforcementOptions {
  validationOnly?: boolean;
  riskTiers?: RiskTier[];
  toolNames?: string[];
}

export type RuntimeGateEnforcementEligibilityReason =
  | "eligible"
  | "eligible-validation-only"
  | "mode-off"
  | "mode-observe"
  | "mode-shadow"
  | "allowlist-excluded"
  | "tool-name-excluded"
  | "risk-tier-excluded";

export type PolicyComparisonClassification =
  | "match"
  | "runtime_allow_tracegate_block"
  | "runtime_allow_tracegate_review"
  | "runtime_allow_tracegate_requires_evidence"
  | "runtime_allow_tracegate_requires_approval"
  | "runtime_block_tracegate_allow"
  | "approval_diagnostics_missing";

export interface PolicyComparisonResult {
  toolName: string;
  riskTier: RiskTier;
  runtimeVerdict: PolicyVerdictStatus;
  traceGateVerdict: PolicyVerdictStatus;
  classifications: PolicyComparisonClassification[];
  gapCategory?: PolicyComparisonGapCategory | undefined;
}

export type PolicyComparisonGapCategory =
  | "policy_gap"
  | "evidence_gap"
  | "approval_gap"
  | "runtime_bug_candidate";

export type RuntimeGatePreventability =
  | "prevented"
  | "preventable_pre_call"
  | "not_preventable_at_pre_call"
  | "requires_post_call_evidence"
  | "observational";

export interface RuntimeGateSummary {
  mode: RuntimeGateMode;
  runId?: string | undefined;
  toolCallId?: string | undefined;
  toolName: string;
  riskTier: RiskTier;
  status: "executed" | "blocked" | "failed" | "skipped";
  handlerExecuted: boolean;
  toolExecuted?: boolean | undefined;
  handlerSkippedReason?: HandlerSkippedReason | undefined;
  sideEffectPrevented: boolean;
  wouldHaveExecutedInShadow?: boolean | undefined;
  enforcementEligible: boolean;
  enforcementEligibilityReason: RuntimeGateEnforcementEligibilityReason;
  enforcementScopeMatched: boolean;
  enforcementApplied?: boolean | undefined;
  validationOnly?: boolean | undefined;
  validationFailed: boolean;
  sideEffectClass?: ToolSideEffectClass | undefined;
  preCallVerdict?: PolicyVerdict | undefined;
  postCallVerdict?: PolicyVerdict | undefined;
  runtimeVerdict?: PolicyVerdict | PolicyVerdictStatus | undefined;
  evidenceSatisfied?: boolean | undefined;
  sideEffectAlreadyOccurred?: boolean | undefined;
  enforceablePreCall?: boolean | undefined;
  preventability?: RuntimeGatePreventability | undefined;
  context?: HarnessContext | undefined;
  contractMetadata?: JsonObject | undefined;
  finalVerdict?: PolicyVerdict;
  diagnostics: PolicyDiagnostic[];
  traceEventTypes: TraceEvent["type"][];
  traceEventCount: number;
  secretLeakFindingCount: number;
  shadowComparison?: PolicyComparisonResult | undefined;
}

export interface RuntimeGateErrorContext {
  contract: ToolContract;
  input: unknown;
  summary: RuntimeGateSummary;
}

export interface RuntimeGateOptions {
  mode: RuntimeGateMode;
  allowlist?: readonly string[];
  contractResolver?: (toolName: string) => ToolContract | undefined;
  policyEvaluator?: PolicyEvaluator;
  runtimeVerdictEvaluator?: PolicyEvaluator;
  approvalHandler?: ApprovalHandler;
  traceSink?: TraceSink;
  redaction?: RedactValueOptions;
  onSummary?: (summary: RuntimeGateSummary) => Promise<void> | void;
  enforcement?: RuntimeGateEnforcementOptions;
  errorAdapter?: (error: unknown, context: RuntimeGateErrorContext) => unknown;
  context?: HarnessContext;
  traceRunEvents?: boolean;
}

export interface PreCallDecision {
  id: string;
  runId: string;
  toolCallId?: string | undefined;
  toolName: string;
  riskTier: RiskTier;
  sideEffectClass: ToolSideEffectClass;
  decision: PolicyVerdictStatus;
  inputValid: boolean;
  parsedInput?: unknown;
  preCallVerdict?: PolicyVerdict | undefined;
  evidenceSatisfied: boolean;
  sideEffectAlreadyOccurred: false;
  enforceablePreCall: boolean;
  preventability: RuntimeGatePreventability;
  summary: RuntimeGateSummary;
}

export interface RuntimeGateReconcileInput {
  output?: unknown;
  evidence?: EvidenceRecord[] | undefined;
  runtimeVerdict?: PolicyVerdict | PolicyVerdictStatus | undefined;
  sideEffectAlreadyOccurred?: boolean | undefined;
  metadata?: JsonObject | undefined;
}

interface StoredPreCallDecision {
  decision: PreCallDecision;
  contract: ToolContract;
  input: JsonValue | undefined;
  startedAt?: string | undefined;
  traceEventTypes: TraceEvent["type"][];
  writeEvent: (event: RuntimeGateTraceEventInput) => Promise<void>;
}

export interface RuntimeGate {
  readonly mode: RuntimeGateMode;
  wrapTool<TInputSchema extends TraceGateInputSchema, TResult>(
    contract: ToolContract<TInputSchema>,
    execute: (input: InferToolOutput<TInputSchema>) => Promise<TResult> | TResult,
  ): (input: InferToolInput<TInputSchema>) => Promise<TResult | unknown>;
  preflightToolCall<TInputSchema extends TraceGateInputSchema>(
    contract: ToolContract<TInputSchema>,
    input: InferToolInput<TInputSchema>,
  ): Promise<PreCallDecision>;
  reconcileToolCall(
    preflightOrId: PreCallDecision | string,
    result?: RuntimeGateReconcileInput,
  ): Promise<RuntimeGateSummary>;
  resolveContract(toolName: string): ToolContract | undefined;
}

export function createRuntimeGate(options: RuntimeGateOptions): RuntimeGate {
  let sequence = 0;
  const gateRunId = createId("gate");
  let writeQueue: Promise<void> = Promise.resolve();
  const policyEvaluator = options.policyEvaluator ?? evaluatePolicy;
  const preflights = new Map<string, StoredPreCallDecision>();

  const wrapTool = <TInputSchema extends TraceGateInputSchema, TResult>(
    contract: ToolContract<TInputSchema>,
    execute: (input: InferToolOutput<TInputSchema>) => Promise<TResult> | TResult,
  ) => {
    return async (input: InferToolInput<TInputSchema>): Promise<TResult | unknown> => {
      if (options.mode === "off") {
        return execute(input as InferToolOutput<TInputSchema>);
      }

      if (!isToolAllowed(contract, options.allowlist)) {
        const result = await execute(input as InferToolOutput<TInputSchema>);
        void emitSummary(options, {
          ...createSummaryBase(options, contract, options.context?.runId ?? gateRunId),
          mode: options.mode,
          status: "skipped",
          handlerExecuted: true,
          toolExecuted: true,
          enforcementApplied: false,
          validationOnly: false,
          sideEffectPrevented: false,
          sideEffectClass: contract.sideEffectClass,
          evidenceSatisfied: true,
          sideEffectAlreadyOccurred: true,
          enforceablePreCall: false,
          preventability: "observational",
          validationFailed: false,
          diagnostics: [],
          traceEventTypes: [],
          traceEventCount: 0,
          secretLeakFindingCount: countSecretFindings({ input, output: result }, options.redaction),
        }).catch(() => undefined);
        return result;
      }

      const runId = options.traceRunEvents
        ? (options.context?.runId ?? createId("run"))
        : gateRunId;
      const runStartedAt = options.traceRunEvents ? nowIso() : undefined;
      const traceEventTypes: TraceEvent["type"][] = [];
      const writeEvent = async (event: RuntimeGateTraceEventInput): Promise<void> => {
        sequence += 1;
        const nextEvent: TraceEvent = { sequence, ...event };
        traceEventTypes.push(nextEvent.type);
        const writeOperation = writeQueue.then(() => options.traceSink?.write(nextEvent));
        writeQueue = writeOperation.catch(() => undefined);
        await writeOperation;
      };
      await writeRunEvent({
        type: "run.started",
        contract,
        runId,
        startedAt: runStartedAt,
        options,
        writeEvent,
      });
      const parsed = contract.inputSchema.safeParse(input);
      const enforcementApplies = shouldEnforce(contract, options.enforcement);

      if (!parsed.success && options.mode === "enforce" && enforcementApplies) {
        const error = new TraceGateInputValidationError("Tool input failed contract validation.", {
          runId,
          toolName: contract.name,
          cause: parsed.error,
        });
        const summary = await blockBeforeExecution({
          contract,
          input: toJsonValue(input, options.redaction),
          error,
          options,
          runId,
          ...(runStartedAt ? { startedAt: runStartedAt } : {}),
          traceEventTypes,
          writeEvent,
          validationFailed: true,
          handlerSkippedReason: "validation-failed",
        });
        return adaptOrThrow(error, contract, input, summary, options);
      }

      const parsedInput = parsed.success ? parsed.data : (input as InferToolOutput<TInputSchema>);
      const { verdict, shadowComparison } = parsed.success
        ? await resolveGateVerdict({
            contract,
            input: parsed.data,
            policyEvaluator,
            options,
          })
        : {};

      if (
        options.mode === "enforce" &&
        enforcementApplies &&
        !options.enforcement?.validationOnly &&
        verdict &&
        (verdict.status === "block" || verdict.status === "review")
      ) {
        const blockedVerdict = appendPolicyDiagnostic(verdict, {
          source: "runtime",
          rule: "execution-skipped",
          message: `Tool was not executed because the policy verdict was ${verdict.status}.`,
          riskTier: contract.riskTier,
        });
        const error =
          blockedVerdict.status === "review"
            ? new TraceGateReviewRequiredError("Tool call requires review before execution.", {
                runId,
                toolName: contract.name,
                verdict: blockedVerdict,
              })
            : new TraceGatePolicyBlockedError("Tool call blocked by TraceGate policy.", {
                runId,
                toolName: contract.name,
                verdict: blockedVerdict,
              });
        const summary = await blockBeforeExecution({
          contract,
          input: toJsonValue(parsedInput, options.redaction),
          error,
          options,
          runId,
          ...(runStartedAt ? { startedAt: runStartedAt } : {}),
          traceEventTypes,
          writeEvent,
          finalVerdict: blockedVerdict,
          handlerSkippedReason: inferHandlerSkippedReason({ verdict: blockedVerdict }),
          shadowComparison,
        });
        return adaptOrThrow(error, contract, input, summary, options);
      }

      const started = await writeToolEvent({
        contract,
        runId,
        input: toJsonValue(parsedInput, options.redaction),
        status: "started",
        type: "tool.started",
        policyVerdict: verdict,
        writeEvent,
      });

      try {
        const result = await execute(parsedInput as InferToolOutput<TInputSchema>);
        const succeeded = await writeToolEvent({
          contract,
          runId,
          input: started.input,
          output: result,
          status: "succeeded",
          type: "tool.succeeded",
          policyVerdict: verdict,
          redaction: options.redaction,
          writeEvent,
        });
        await writeRunEvent({
          type: "run.finished",
          status: "succeeded",
          contract,
          runId,
          startedAt: runStartedAt,
          toolCalls: [started, succeeded],
          options,
          writeEvent,
        });
        await emitSummary(options, {
          ...createSummaryBase(options, contract, runId, started.id),
          mode: options.mode,
          status: "executed",
          handlerExecuted: true,
          toolExecuted: true,
          sideEffectPrevented: false,
          sideEffectClass: contract.sideEffectClass,
          ...(shadowComparison
            ? { wouldHaveExecutedInShadow: getShadowWouldHaveExecuted(shadowComparison) }
            : {}),
          validationFailed: !parsed.success,
          ...(verdict ? { finalVerdict: verdict } : {}),
          ...(verdict ? { preCallVerdict: verdict } : {}),
          evidenceSatisfied: !hasMissingEvidenceDiagnostic(verdict),
          sideEffectAlreadyOccurred: true,
          enforceablePreCall: false,
          preventability: "observational",
          diagnostics: verdict?.diagnostics ?? [],
          traceEventTypes: [...traceEventTypes],
          traceEventCount: traceEventTypes.length,
          secretLeakFindingCount: countSecretFindings({ input, output: result }, options.redaction),
          ...(shadowComparison ? { shadowComparison } : {}),
        });
        return result;
      } catch (cause) {
        const error = new TraceGateToolExecutionError("Tool execution failed.", {
          runId,
          toolName: contract.name,
          ...(verdict ? { verdict } : {}),
          cause,
        });
        const failed = await writeToolEvent({
          contract,
          runId,
          input: started.input,
          status: "failed",
          type: "tool.failed",
          policyVerdict: verdict,
          error: getErrorMessage(cause),
          redaction: options.redaction,
          writeEvent,
        });
        await writeRunEvent({
          type: "run.finished",
          status: "failed",
          contract,
          runId,
          startedAt: runStartedAt,
          toolCalls: [started, failed],
          options,
          writeEvent,
        });
        const summary: RuntimeGateSummary = {
          ...createSummaryBase(options, contract, runId, started.id),
          mode: options.mode,
          status: "failed",
          handlerExecuted: true,
          toolExecuted: true,
          sideEffectPrevented: false,
          sideEffectClass: contract.sideEffectClass,
          ...(shadowComparison
            ? { wouldHaveExecutedInShadow: getShadowWouldHaveExecuted(shadowComparison) }
            : {}),
          validationFailed: !parsed.success,
          ...(verdict ? { finalVerdict: verdict } : {}),
          ...(verdict ? { preCallVerdict: verdict } : {}),
          evidenceSatisfied: !hasMissingEvidenceDiagnostic(verdict),
          sideEffectAlreadyOccurred: true,
          enforceablePreCall: false,
          preventability: "observational",
          diagnostics: verdict?.diagnostics ?? [],
          traceEventTypes: [...traceEventTypes],
          traceEventCount: traceEventTypes.length,
          secretLeakFindingCount: countSecretFindings({ input }, options.redaction),
          ...(shadowComparison ? { shadowComparison } : {}),
        };
        await emitSummary(options, summary);
        return adaptOrThrow(error, contract, input, summary, options);
      }
    };
  };

  const preflightToolCall = async <TInputSchema extends TraceGateInputSchema>(
    contract: ToolContract<TInputSchema>,
    input: InferToolInput<TInputSchema>,
  ): Promise<PreCallDecision> => {
    if (options.mode === "off" || !isToolAllowed(contract, options.allowlist)) {
      return createBypassPreCallDecision({
        contract,
        input,
        mode: options.mode,
        options,
        runId: options.context?.runId ?? gateRunId,
      });
    }

    const runId = options.traceRunEvents ? (options.context?.runId ?? createId("run")) : gateRunId;
    const runStartedAt = options.traceRunEvents ? nowIso() : undefined;
    const traceEventTypes: TraceEvent["type"][] = [];
    const writeEvent = async (event: RuntimeGateTraceEventInput): Promise<void> => {
      sequence += 1;
      const nextEvent: TraceEvent = { sequence, ...event };
      traceEventTypes.push(nextEvent.type);
      const writeOperation = writeQueue.then(() => options.traceSink?.write(nextEvent));
      writeQueue = writeOperation.catch(() => undefined);
      await writeOperation;
    };
    await writeRunEvent({
      type: "run.started",
      contract,
      runId,
      startedAt: runStartedAt,
      options,
      writeEvent,
    });

    const parsed = contract.inputSchema.safeParse(input);
    const parsedInput = parsed.success ? parsed.data : input;
    const { verdict, shadowComparison } = parsed.success
      ? await resolveGateVerdict({
          contract,
          input: parsed.data,
          policyEvaluator,
          options,
        })
      : {};
    const enforcementApplies = shouldEnforce(contract, options.enforcement);
    const preCallStatus = parsed.success ? (verdict?.status ?? "allow") : "block";
    const enforceablePreCall =
      options.mode === "enforce" &&
      enforcementApplies &&
      (options.enforcement?.validationOnly === true
        ? !parsed.success
        : preCallStatus === "block" || preCallStatus === "review" || !parsed.success);
    const evidenceSatisfied = !hasMissingEvidenceDiagnostic(verdict);
    const preventability = getPreventability({
      contract,
      verdictStatus: preCallStatus,
      evidenceSatisfied,
      sideEffectAlreadyOccurred: false,
      enforceablePreCall,
    });
    const redactedInput = toJsonValue(parsedInput, options.redaction);
    const preCallRecord = await writeToolEvent({
      contract,
      runId,
      input: redactedInput,
      status: preCallStatus === "allow" || preCallStatus === "warn" ? "started" : "blocked",
      type: "tool.pre_call",
      policyVerdict: verdict,
      ...(parsed.success ? {} : { error: "Tool input failed contract validation." }),
      metadata: {
        stage: "pre_call",
        decision: preCallStatus,
        evidenceSatisfied,
        sideEffectAlreadyOccurred: false,
        enforceablePreCall,
        preventability,
      },
      writeEvent,
    });
    const summary: RuntimeGateSummary = {
      ...createSummaryBase(options, contract, runId, preCallRecord.id),
      mode: options.mode,
      status: enforceablePreCall ? "blocked" : "skipped",
      handlerExecuted: false,
      toolExecuted: false,
      handlerSkippedReason: enforceablePreCall
        ? inferHandlerSkippedReason({ verdict, validationFailed: !parsed.success })
        : undefined,
      sideEffectPrevented: enforceablePreCall,
      ...(shadowComparison
        ? { wouldHaveExecutedInShadow: getShadowWouldHaveExecuted(shadowComparison) }
        : {}),
      validationFailed: !parsed.success,
      sideEffectClass: contract.sideEffectClass,
      ...(verdict ? { finalVerdict: verdict, preCallVerdict: verdict } : {}),
      evidenceSatisfied,
      sideEffectAlreadyOccurred: false,
      enforceablePreCall,
      preventability,
      diagnostics: verdict?.diagnostics ?? [],
      traceEventTypes: [...traceEventTypes],
      traceEventCount: traceEventTypes.length,
      secretLeakFindingCount: countSecretFindings({ input }, options.redaction),
      ...(shadowComparison ? { shadowComparison } : {}),
    };
    const decision: PreCallDecision = {
      id: preCallRecord.id,
      runId,
      toolCallId: preCallRecord.id,
      toolName: contract.name,
      riskTier: contract.riskTier,
      sideEffectClass: contract.sideEffectClass,
      decision: preCallStatus,
      inputValid: parsed.success,
      ...(parsed.success ? { parsedInput: parsed.data } : {}),
      ...(verdict ? { preCallVerdict: verdict } : {}),
      evidenceSatisfied,
      sideEffectAlreadyOccurred: false,
      enforceablePreCall,
      preventability,
      summary,
    };
    if (!enforceablePreCall) {
      preflights.set(decision.id, {
        decision,
        contract,
        input: redactedInput,
        ...(runStartedAt ? { startedAt: runStartedAt } : {}),
        traceEventTypes,
        writeEvent,
      });
    }
    await emitSummary(options, summary);
    return decision;
  };

  const reconcileToolCall = async (
    preflightOrId: PreCallDecision | string,
    result: RuntimeGateReconcileInput = {},
  ): Promise<RuntimeGateSummary> => {
    const id = typeof preflightOrId === "string" ? preflightOrId : preflightOrId.id;
    const stored = preflights.get(id);
    if (!stored) {
      if (typeof preflightOrId !== "string") {
        return reconcileBypassPreCallDecision(preflightOrId, result, options);
      }
      throw new Error(`No runtime gate preflight is active for tool call "${id}".`);
    }
    try {
      const sideEffectAlreadyOccurred = result.sideEffectAlreadyOccurred ?? false;
      const postCallVerdict = await policyEvaluator({
        contract: stored.contract,
        input: stored.decision.parsedInput ?? stored.input,
        approval: inferApprovalFromVerdict(stored.decision.preCallVerdict),
        evidence: result.evidence ?? [],
        ...(options.context ? { context: options.context } : {}),
      });
      const evidenceSatisfied = !hasMissingEvidenceDiagnostic(postCallVerdict);
      const runtimeVerdict =
        result.runtimeVerdict ?? (sideEffectAlreadyOccurred ? "allow" : "review");
      const runtimeStatus = normalizeRuntimeVerdictStatus(runtimeVerdict);
      const preventability = getPreventability({
        contract: stored.contract,
        verdictStatus: postCallVerdict.status,
        evidenceSatisfied,
        sideEffectAlreadyOccurred,
        enforceablePreCall: stored.decision.enforceablePreCall,
      });
      for (const evidence of result.evidence ?? []) {
        await stored.writeEvent({
          type: "evidence.recorded",
          timestamp: nowIso(),
          runId: stored.decision.runId,
          record: evidence,
        });
      }
      const reconciled = await writeToolEvent({
        contract: stored.contract,
        runId: stored.decision.runId,
        input: stored.input,
        output: result.output,
        redaction: options.redaction,
        status: runtimeStatus === "block" || runtimeStatus === "review" ? "blocked" : "succeeded",
        type: "tool.post_call",
        policyVerdict: postCallVerdict,
        metadata: {
          ...(result.metadata ?? {}),
          stage: "post_call",
          runtimeVerdict: runtimeStatus,
          evidenceSatisfied,
          sideEffectAlreadyOccurred,
          enforceablePreCall: stored.decision.enforceablePreCall,
          preventability,
        },
        writeEvent: stored.writeEvent,
      });
      await writeToolEvent({
        contract: stored.contract,
        runId: stored.decision.runId,
        input: stored.input,
        output: result.output,
        redaction: options.redaction,
        status:
          postCallVerdict.status === "block" || postCallVerdict.status === "review"
            ? "blocked"
            : "succeeded",
        type: "tool.reconciled",
        policyVerdict: postCallVerdict,
        metadata: {
          stage: "reconciled",
          runtimeVerdict: runtimeStatus,
          evidenceSatisfied,
          sideEffectAlreadyOccurred,
          enforceablePreCall: stored.decision.enforceablePreCall,
          preventability,
        },
        writeEvent: stored.writeEvent,
      });
      await writeRunEvent({
        type: "run.finished",
        status:
          postCallVerdict.status === "block" || postCallVerdict.status === "review"
            ? "blocked"
            : "succeeded",
        contract: stored.contract,
        runId: stored.decision.runId,
        startedAt: stored.startedAt,
        toolCalls: [reconciled],
        evidence: result.evidence ?? [],
        options,
        writeEvent: stored.writeEvent,
      });
      const summary: RuntimeGateSummary = {
        ...createSummaryBase(options, stored.contract, stored.decision.runId, stored.decision.id),
        mode: options.mode,
        status: sideEffectAlreadyOccurred ? "executed" : "skipped",
        handlerExecuted: sideEffectAlreadyOccurred,
        toolExecuted: sideEffectAlreadyOccurred,
        sideEffectPrevented: !sideEffectAlreadyOccurred && stored.decision.enforceablePreCall,
        validationFailed: !stored.decision.inputValid,
        sideEffectClass: stored.contract.sideEffectClass,
        ...(stored.decision.preCallVerdict
          ? { preCallVerdict: stored.decision.preCallVerdict }
          : {}),
        postCallVerdict,
        runtimeVerdict,
        finalVerdict: postCallVerdict,
        evidenceSatisfied,
        sideEffectAlreadyOccurred,
        enforceablePreCall: stored.decision.enforceablePreCall,
        preventability,
        diagnostics: postCallVerdict.diagnostics ?? [],
        traceEventTypes: [...stored.traceEventTypes],
        traceEventCount: stored.traceEventTypes.length,
        secretLeakFindingCount: countSecretFindings(
          { input: stored.input, output: result.output },
          options.redaction,
        ),
      };
      await emitSummary(options, summary);
      return summary;
    } finally {
      preflights.delete(id);
    }
  };

  return {
    mode: options.mode,
    wrapTool,
    preflightToolCall,
    reconcileToolCall,
    resolveContract(toolName) {
      if (options.allowlist && !options.allowlist.includes(toolName)) {
        return undefined;
      }
      return options.contractResolver?.(toolName);
    },
  };
}

export function comparePolicyVerdicts(input: {
  contract: ToolContract;
  runtimeVerdict: PolicyVerdict;
  traceGateVerdict: PolicyVerdict;
}): PolicyComparisonResult {
  const classifications: PolicyComparisonClassification[] = [];
  const runtime = input.runtimeVerdict.status;
  const tracegate = input.traceGateVerdict.status;
  const runtimeAllows = runtime === "allow" || runtime === "warn";
  const runtimeBlocks = runtime === "block" || runtime === "review";
  const traceAllows = tracegate === "allow" || tracegate === "warn";

  if (runtimeAllows && tracegate === "block") {
    classifications.push("runtime_allow_tracegate_block");
  }
  if (runtimeAllows && tracegate === "review") {
    classifications.push("runtime_allow_tracegate_review");
    if (hasMissingEvidenceDiagnostic(input.traceGateVerdict)) {
      classifications.push("runtime_allow_tracegate_requires_evidence");
    } else if (hasApprovalDiagnostic(input.traceGateVerdict)) {
      classifications.push("runtime_allow_tracegate_requires_approval");
    }
  }
  if (runtimeBlocks && traceAllows) {
    classifications.push("runtime_block_tracegate_allow");
  }
  if (
    tracegate === "block" &&
    !input.traceGateVerdict.diagnostics?.some((diagnostic) =>
      diagnostic.rule.startsWith("approval-"),
    )
  ) {
    classifications.push("approval_diagnostics_missing");
  }

  if (classifications.length === 0) {
    classifications.push("match");
  }

  return {
    toolName: input.contract.name,
    riskTier: input.contract.riskTier,
    runtimeVerdict: runtime,
    traceGateVerdict: tracegate,
    classifications,
    gapCategory: classifyPolicyGap(classifications),
  };
}

export function summarizePolicyComparisons(comparisons: PolicyComparisonResult[]): JsonObject {
  const summary: Record<string, number> = {};
  for (const comparison of comparisons) {
    for (const classification of comparison.classifications) {
      const key = `${comparison.toolName}:${comparison.riskTier}:${classification}`;
      summary[key] = (summary[key] ?? 0) + 1;
    }
  }
  return summary;
}

async function resolveGateVerdict(input: {
  contract: ToolContract;
  input: unknown;
  policyEvaluator: PolicyEvaluator;
  options: RuntimeGateOptions;
}): Promise<{
  verdict: PolicyVerdict;
  shadowComparison?: PolicyComparisonResult | undefined;
}> {
  const verdictPromise = resolvePolicyVerdict(input);
  if (input.options.mode !== "shadow" || !input.options.runtimeVerdictEvaluator) {
    return { verdict: await verdictPromise };
  }

  const runtimeVerdictPromise = input.options.runtimeVerdictEvaluator({
    contract: input.contract,
    input: input.input,
    approval: "missing",
    ...(input.options.context ? { context: input.options.context } : {}),
  });
  const [verdictResult, runtimeVerdictResult] = await Promise.allSettled([
    verdictPromise,
    runtimeVerdictPromise,
  ]);

  if (verdictResult.status === "rejected") {
    throw verdictResult.reason;
  }
  if (runtimeVerdictResult.status === "rejected") {
    throw runtimeVerdictResult.reason;
  }

  return {
    verdict: verdictResult.value,
    shadowComparison: comparePolicyVerdicts({
      contract: input.contract,
      runtimeVerdict: runtimeVerdictResult.value,
      traceGateVerdict: verdictResult.value,
    }),
  };
}

async function resolvePolicyVerdict(input: {
  contract: ToolContract;
  input: unknown;
  policyEvaluator: PolicyEvaluator;
  options: RuntimeGateOptions;
}): Promise<PolicyVerdict> {
  const initial = await input.policyEvaluator({
    contract: input.contract,
    input: input.input,
    approval: "missing",
    ...(input.options.context ? { context: input.options.context } : {}),
  });
  if (initial.status !== "review") {
    return initial;
  }

  return resolvePolicyVerdictAfterReview({
    contract: input.contract,
    input: input.input,
    context: input.options.context ?? {},
    initialVerdict: initial,
    approvalHandler: input.options.approvalHandler,
    evaluateWithApproval: (approval) =>
      input.policyEvaluator({
        contract: input.contract,
        input: input.input,
        approval,
        ...(input.options.context ? { context: input.options.context } : {}),
      }),
  });
}

async function blockBeforeExecution(input: {
  contract: ToolContract;
  runId: string;
  input: JsonValue | undefined;
  error: Error;
  options: RuntimeGateOptions;
  traceEventTypes: TraceEvent["type"][];
  writeEvent: (event: RuntimeGateTraceEventInput) => Promise<void>;
  startedAt?: string;
  validationFailed?: boolean;
  finalVerdict?: PolicyVerdict | undefined;
  handlerSkippedReason?: HandlerSkippedReason | undefined;
  shadowComparison?: PolicyComparisonResult | undefined;
}): Promise<RuntimeGateSummary> {
  const blocked = await writeToolEvent({
    contract: input.contract,
    runId: input.runId,
    input: input.input,
    status: "blocked",
    type: "tool.blocked",
    policyVerdict: input.finalVerdict,
    error: input.error.message,
    writeEvent: input.writeEvent,
  });
  await writeRunEvent({
    type: "run.finished",
    status: "blocked",
    contract: input.contract,
    runId: input.runId,
    startedAt: input.startedAt,
    toolCalls: [blocked],
    options: input.options,
    writeEvent: input.writeEvent,
  });
  const summary: RuntimeGateSummary = {
    ...createSummaryBase(input.options, input.contract, input.runId, blocked.id),
    mode: input.options.mode,
    status: "blocked",
    handlerExecuted: false,
    toolExecuted: false,
    handlerSkippedReason:
      input.handlerSkippedReason ??
      inferHandlerSkippedReason({
        verdict: input.finalVerdict,
        validationFailed: input.validationFailed,
      }),
    sideEffectPrevented: true,
    sideEffectClass: input.contract.sideEffectClass,
    ...(input.shadowComparison
      ? { wouldHaveExecutedInShadow: getShadowWouldHaveExecuted(input.shadowComparison) }
      : {}),
    validationFailed: input.validationFailed === true,
    ...(input.finalVerdict ? { finalVerdict: input.finalVerdict } : {}),
    ...(input.finalVerdict ? { preCallVerdict: input.finalVerdict } : {}),
    evidenceSatisfied: !hasMissingEvidenceDiagnostic(input.finalVerdict),
    sideEffectAlreadyOccurred: false,
    enforceablePreCall: true,
    preventability: "prevented",
    diagnostics: input.finalVerdict?.diagnostics ?? [],
    traceEventTypes: [...input.traceEventTypes],
    traceEventCount: input.traceEventTypes.length,
    secretLeakFindingCount: countSecretFindings(input.input, input.options.redaction),
    ...(input.shadowComparison ? { shadowComparison: input.shadowComparison } : {}),
  };
  await emitSummary(input.options, summary);
  return summary;
}

async function writeToolEvent(input: {
  contract: ToolContract;
  runId: string;
  input?: JsonValue | undefined;
  output?: unknown;
  redaction?: RedactValueOptions | undefined;
  status: ToolCallStatus;
  type: ToolTraceEvent["type"];
  policyVerdict?: PolicyVerdict | undefined;
  error?: string;
  metadata?: unknown;
  writeEvent: (event: RuntimeGateTraceEventInput) => Promise<void>;
}): Promise<ToolCallRecord> {
  const { record, timestamp } = createToolCallRecord({
    runId: input.runId,
    redaction: input.redaction,
    record: {
      toolName: input.contract.name,
      status: input.status,
      riskTier: input.contract.riskTier,
      ...(input.input !== undefined ? { input: input.input } : {}),
      ...(input.output !== undefined ? { output: input.output } : {}),
      ...(input.policyVerdict ? { policyVerdict: input.policyVerdict } : {}),
      ...(input.error ? { error: input.error } : {}),
      ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
    },
  });
  await input.writeEvent({
    type: input.type,
    timestamp,
    runId: record.runId,
    record,
  });
  return record;
}

async function writeRunEvent(input: {
  type: RunTraceEvent["type"];
  contract: ToolContract;
  runId: string;
  options: RuntimeGateOptions;
  writeEvent: (event: RuntimeGateTraceEventInput) => Promise<void>;
  startedAt?: string | undefined;
  status?: TraceGateRunStatus;
  toolCalls?: ToolCallRecord[];
  evidence?: EvidenceRecord[];
}): Promise<void> {
  if (!input.options.traceRunEvents) {
    return;
  }

  const timestamp = input.type === "run.started" ? (input.startedAt ?? nowIso()) : nowIso();
  const startedAt = input.startedAt ?? timestamp;
  const status = input.status ?? "running";
  await input.writeEvent({
    type: input.type,
    timestamp,
    runId: input.runId,
    run: {
      id: input.runId,
      startedAt,
      ...(input.type === "run.finished" ? { finishedAt: timestamp } : {}),
      status,
      toolCalls: input.toolCalls ?? [],
      evidence: input.evidence ?? [],
      ...(input.options.context ? { context: normalizeContext(input.options) } : {}),
      metadata: {
        runtimeGate: true,
        toolName: input.contract.name,
      },
    },
  });
}

function createSummaryBase(
  options: RuntimeGateOptions,
  contract: ToolContract,
  runId: string,
  toolCallId?: string,
): Pick<
  RuntimeGateSummary,
  | "runId"
  | "toolCallId"
  | "toolName"
  | "riskTier"
  | "context"
  | "contractMetadata"
  | "enforcementEligible"
  | "enforcementEligibilityReason"
  | "enforcementScopeMatched"
  | "enforcementApplied"
  | "validationOnly"
> {
  const context = normalizeContext(options);
  const contractMetadata = normalizeJsonObject(contract.metadata, options.redaction);
  const eligibility = getEnforcementEligibility(options, contract);

  return {
    runId,
    ...(toolCallId ? { toolCallId } : {}),
    toolName: contract.name,
    riskTier: contract.riskTier,
    ...(context ? { context } : {}),
    ...(contractMetadata && Object.keys(contractMetadata).length > 0 ? { contractMetadata } : {}),
    enforcementEligible: eligibility.enforcementEligible,
    enforcementEligibilityReason: eligibility.enforcementEligibilityReason,
    enforcementScopeMatched: eligibility.enforcementScopeMatched,
    enforcementApplied: eligibility.enforcementEligible,
    validationOnly: eligibility.enforcementEligible && options.enforcement?.validationOnly === true,
  };
}

function createBypassPreCallDecision(input: {
  contract: ToolContract;
  input: unknown;
  mode: RuntimeGateMode;
  options: RuntimeGateOptions;
  runId: string;
}): PreCallDecision {
  const summary: RuntimeGateSummary = {
    ...createSummaryBase(input.options, input.contract, input.runId),
    mode: input.mode,
    status: "skipped",
    handlerExecuted: false,
    toolExecuted: false,
    sideEffectPrevented: false,
    validationFailed: false,
    sideEffectClass: input.contract.sideEffectClass,
    evidenceSatisfied: true,
    sideEffectAlreadyOccurred: false,
    enforceablePreCall: false,
    preventability: "observational",
    diagnostics: [],
    traceEventTypes: [],
    traceEventCount: 0,
    secretLeakFindingCount: countSecretFindings(input.input, input.options.redaction),
  };

  return {
    id: createId("preflight"),
    runId: input.runId,
    toolName: input.contract.name,
    riskTier: input.contract.riskTier,
    sideEffectClass: input.contract.sideEffectClass,
    decision: "allow",
    inputValid: true,
    evidenceSatisfied: true,
    sideEffectAlreadyOccurred: false,
    enforceablePreCall: false,
    preventability: "observational",
    summary,
  };
}

async function reconcileBypassPreCallDecision(
  decision: PreCallDecision,
  result: RuntimeGateReconcileInput,
  options: RuntimeGateOptions,
): Promise<RuntimeGateSummary> {
  const sideEffectAlreadyOccurred = result.sideEffectAlreadyOccurred ?? false;
  const runtimeVerdict = result.runtimeVerdict ?? (sideEffectAlreadyOccurred ? "allow" : "review");
  const summary: RuntimeGateSummary = {
    ...decision.summary,
    status: sideEffectAlreadyOccurred ? "executed" : decision.summary.status,
    handlerExecuted: sideEffectAlreadyOccurred,
    toolExecuted: sideEffectAlreadyOccurred,
    runtimeVerdict,
    evidenceSatisfied: decision.evidenceSatisfied,
    sideEffectAlreadyOccurred,
    sideEffectPrevented: !sideEffectAlreadyOccurred && decision.enforceablePreCall,
    secretLeakFindingCount: countSecretFindings({ output: result.output }, options.redaction),
  };

  if (options.mode !== "off") {
    await emitSummary(options, summary);
  }
  return summary;
}

function normalizeContext(options: RuntimeGateOptions): HarnessContext | undefined {
  if (!options.context) {
    return undefined;
  }
  const value = normalizeJsonObject(options.context, options.redaction);
  return value ? HarnessContextSchema.parse(value) : undefined;
}

function normalizeJsonObject(
  value: unknown,
  redaction: RedactValueOptions | undefined,
): JsonObject | undefined {
  return toJsonObject(value, redaction);
}

function adaptOrThrow(
  error: unknown,
  contract: ToolContract,
  input: unknown,
  summary: RuntimeGateSummary,
  options: RuntimeGateOptions,
): unknown {
  if (options.errorAdapter) {
    return options.errorAdapter(error, { contract, input, summary });
  }
  throw error;
}

function shouldEnforce(contract: ToolContract, enforcement: RuntimeGateEnforcementOptions = {}) {
  return getEnforcementScopeMatch(contract, enforcement).enforcementMatches;
}

function isToolAllowed(contract: ToolContract, allowlist: readonly string[] | undefined): boolean {
  return allowlist === undefined || allowlist.includes(contract.name);
}

function getEnforcementEligibility(
  options: RuntimeGateOptions,
  contract: ToolContract,
): {
  enforcementEligible: boolean;
  enforcementEligibilityReason: RuntimeGateEnforcementEligibilityReason;
  enforcementScopeMatched: boolean;
} {
  const allowlistMatches = isToolAllowed(contract, options.allowlist);
  const scope = getEnforcementScopeMatch(contract, options.enforcement);
  const enforcementScopeMatched = allowlistMatches && scope.enforcementMatches;

  if (options.mode === "off") {
    return {
      enforcementEligible: false,
      enforcementEligibilityReason: "mode-off",
      enforcementScopeMatched,
    };
  }
  if (options.mode === "observe") {
    return {
      enforcementEligible: false,
      enforcementEligibilityReason: "mode-observe",
      enforcementScopeMatched,
    };
  }
  if (options.mode === "shadow") {
    return {
      enforcementEligible: false,
      enforcementEligibilityReason: "mode-shadow",
      enforcementScopeMatched,
    };
  }
  if (!allowlistMatches) {
    return {
      enforcementEligible: false,
      enforcementEligibilityReason: "allowlist-excluded",
      enforcementScopeMatched,
    };
  }
  if (!scope.toolNameMatches) {
    return {
      enforcementEligible: false,
      enforcementEligibilityReason: "tool-name-excluded",
      enforcementScopeMatched,
    };
  }
  if (!scope.riskTierMatches) {
    return {
      enforcementEligible: false,
      enforcementEligibilityReason: "risk-tier-excluded",
      enforcementScopeMatched,
    };
  }
  return {
    enforcementEligible: true,
    enforcementEligibilityReason:
      options.enforcement?.validationOnly === true ? "eligible-validation-only" : "eligible",
    enforcementScopeMatched,
  };
}

function getEnforcementScopeMatch(
  contract: ToolContract,
  enforcement: RuntimeGateEnforcementOptions = {},
): {
  riskTierMatches: boolean;
  toolNameMatches: boolean;
  enforcementMatches: boolean;
} {
  const riskTierMatches =
    enforcement.riskTiers === undefined || enforcement.riskTiers.includes(contract.riskTier);
  const toolNameMatches =
    enforcement.toolNames === undefined || enforcement.toolNames.includes(contract.name);
  return {
    riskTierMatches,
    toolNameMatches,
    enforcementMatches: riskTierMatches && toolNameMatches,
  };
}

function getShadowWouldHaveExecuted(shadowComparison: PolicyComparisonResult): boolean | undefined {
  return traceGateWouldExecute(shadowComparison.traceGateVerdict);
}

function classifyPolicyGap(
  classifications: PolicyComparisonClassification[],
): PolicyComparisonGapCategory | undefined {
  if (classifications.includes("runtime_allow_tracegate_requires_evidence")) {
    return "evidence_gap";
  }
  if (classifications.includes("runtime_allow_tracegate_requires_approval")) {
    return "approval_gap";
  }
  if (classifications.includes("runtime_allow_tracegate_block")) {
    return "policy_gap";
  }
  if (classifications.includes("runtime_block_tracegate_allow")) {
    return "runtime_bug_candidate";
  }
  return undefined;
}

function hasMissingEvidenceDiagnostic(verdict: PolicyVerdict | undefined): boolean {
  return verdict?.diagnostics?.some((diagnostic) => diagnostic.rule.includes("evidence")) ?? false;
}

function hasApprovalDiagnostic(verdict: PolicyVerdict | undefined): boolean {
  return (
    verdict?.diagnostics?.some(
      (diagnostic) =>
        diagnostic.approval !== undefined ||
        diagnostic.rule.includes("approval") ||
        diagnostic.rule.includes("requires-approval"),
    ) ?? false
  );
}

function inferApprovalFromVerdict(
  verdict: PolicyVerdict | undefined,
): "approved" | "denied" | "missing" {
  if (verdict?.diagnostics?.some((diagnostic) => diagnostic.approval === "denied")) {
    return "denied";
  }
  if (verdict?.diagnostics?.some((diagnostic) => diagnostic.approval === "approved")) {
    return "approved";
  }
  return "missing";
}

function normalizeRuntimeVerdictStatus(
  verdict: PolicyVerdict | PolicyVerdictStatus,
): PolicyVerdictStatus {
  return typeof verdict === "string" ? verdict : verdict.status;
}

function getPreventability(input: {
  contract: ToolContract;
  verdictStatus: PolicyVerdictStatus;
  evidenceSatisfied: boolean;
  sideEffectAlreadyOccurred: boolean;
  enforceablePreCall: boolean;
}): RuntimeGatePreventability {
  if (input.sideEffectAlreadyOccurred) {
    return input.evidenceSatisfied ? "not_preventable_at_pre_call" : "requires_post_call_evidence";
  }
  if (
    input.enforceablePreCall &&
    (input.verdictStatus === "block" || input.verdictStatus === "review")
  ) {
    return "prevented";
  }
  if (
    !input.evidenceSatisfied &&
    (input.contract.sideEffectClass === "persisted_write" ||
      input.contract.sideEffectClass === "external_side_effect")
  ) {
    return "requires_post_call_evidence";
  }
  if (input.verdictStatus === "block" || input.verdictStatus === "review") {
    return "preventable_pre_call";
  }
  return "observational";
}

function countSecretFindings(value: unknown, options?: RedactValueOptions): number {
  return detectSecretLikeValues(redactValue(value, options), {
    ...options,
    ignoreRedactionPlaceholders: true,
  }).length;
}

async function emitSummary(options: RuntimeGateOptions, summary: RuntimeGateSummary) {
  await options.onSummary?.(summary);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
