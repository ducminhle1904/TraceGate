import type { z } from "zod";

import { evaluatePolicy } from "../policy/evaluate-policy.js";
import type { PolicyDiagnostic, PolicyVerdict, PolicyVerdictStatus } from "../policy/verdict.js";
import {
  detectSecretLikeValues,
  type RedactValueOptions,
  redactValue,
} from "../redaction/redact.js";
import type { JsonObject, JsonValue } from "../schema/json.js";
import type { HarnessContext } from "../schema/surface.js";
import type { RiskTier, ToolContract } from "../schema/tool-contract.js";
import type { ToolCallRecord, ToolCallStatus } from "../schema/trace.js";
import { appendPolicyDiagnostic, resolvePolicyVerdictAfterReview } from "./approval-resolution.js";
import {
  TraceGateInputValidationError,
  TraceGatePolicyBlockedError,
  TraceGateReviewRequiredError,
  TraceGateToolExecutionError,
} from "./errors.js";
import type { ApprovalHandler, PolicyEvaluator } from "./harness.js";
import { createId, createToolCallRecord, toJsonValue } from "./tool-record.js";
import type { ToolTraceEvent, TraceEvent, TraceSink } from "./trace-sink.js";

export type RuntimeGateMode = "off" | "observe" | "shadow" | "enforce";

export interface RuntimeGateEnforcementOptions {
  validationOnly?: boolean;
  riskTiers?: RiskTier[];
}

export type PolicyComparisonClassification =
  | "match"
  | "runtime_allow_tracegate_block"
  | "runtime_allow_tracegate_review"
  | "runtime_block_tracegate_allow"
  | "approval_diagnostics_missing";

export interface PolicyComparisonResult {
  toolName: string;
  riskTier: RiskTier;
  runtimeVerdict: PolicyVerdictStatus;
  traceGateVerdict: PolicyVerdictStatus;
  classifications: PolicyComparisonClassification[];
}

export interface RuntimeGateSummary {
  mode: RuntimeGateMode;
  toolName: string;
  riskTier: RiskTier;
  status: "executed" | "blocked" | "failed" | "skipped";
  handlerExecuted: boolean;
  validationFailed: boolean;
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
}

export interface RuntimeGate {
  readonly mode: RuntimeGateMode;
  wrapTool<TInputSchema extends z.ZodType<unknown>, TResult>(
    contract: ToolContract<TInputSchema>,
    execute: (input: z.infer<TInputSchema>) => Promise<TResult> | TResult,
  ): (input: z.input<TInputSchema>) => Promise<TResult | unknown>;
  resolveContract(toolName: string): ToolContract | undefined;
}

export function createRuntimeGate(options: RuntimeGateOptions): RuntimeGate {
  let sequence = 0;
  const runId = createId("gate");
  let writeQueue: Promise<void> = Promise.resolve();
  const policyEvaluator = options.policyEvaluator ?? evaluatePolicy;

  const wrapTool = <TInputSchema extends z.ZodType<unknown>, TResult>(
    contract: ToolContract<TInputSchema>,
    execute: (input: z.infer<TInputSchema>) => Promise<TResult> | TResult,
  ) => {
    return async (input: z.input<TInputSchema>): Promise<TResult | unknown> => {
      if (options.mode === "off") {
        return execute(input as z.infer<TInputSchema>);
      }

      if (!isToolAllowed(contract, options.allowlist)) {
        const result = await execute(input as z.infer<TInputSchema>);
        void emitSummary(options, {
          mode: options.mode,
          toolName: contract.name,
          riskTier: contract.riskTier,
          status: "skipped",
          handlerExecuted: true,
          validationFailed: false,
          diagnostics: [],
          traceEventTypes: [],
          traceEventCount: 0,
          secretLeakFindingCount: countSecretFindings({ input, output: result }, options.redaction),
        }).catch(() => undefined);
        return result;
      }

      const traceEventTypes: TraceEvent["type"][] = [];
      const writeEvent = async (event: Omit<ToolTraceEvent, "sequence">): Promise<void> => {
        sequence += 1;
        const nextEvent: ToolTraceEvent = { sequence, ...event };
        traceEventTypes.push(nextEvent.type);
        const writeOperation = writeQueue.then(() => options.traceSink?.write(nextEvent));
        writeQueue = writeOperation.catch(() => undefined);
        await writeOperation;
      };
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
          traceEventTypes,
          writeEvent,
          validationFailed: true,
        });
        return adaptOrThrow(error, contract, input, summary, options);
      }

      const parsedInput = parsed.success ? parsed.data : (input as z.infer<TInputSchema>);
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
          traceEventTypes,
          writeEvent,
          finalVerdict: blockedVerdict,
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
        const result = await execute(parsedInput);
        await writeToolEvent({
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
        await emitSummary(options, {
          mode: options.mode,
          toolName: contract.name,
          riskTier: contract.riskTier,
          status: "executed",
          handlerExecuted: true,
          validationFailed: !parsed.success,
          ...(verdict ? { finalVerdict: verdict } : {}),
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
        await writeToolEvent({
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
        const summary: RuntimeGateSummary = {
          mode: options.mode,
          toolName: contract.name,
          riskTier: contract.riskTier,
          status: "failed",
          handlerExecuted: true,
          validationFailed: !parsed.success,
          ...(verdict ? { finalVerdict: verdict } : {}),
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

  return {
    mode: options.mode,
    wrapTool,
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
  writeEvent: (event: Omit<ToolTraceEvent, "sequence">) => Promise<void>;
  validationFailed?: boolean;
  finalVerdict?: PolicyVerdict | undefined;
  shadowComparison?: PolicyComparisonResult | undefined;
}): Promise<RuntimeGateSummary> {
  await writeToolEvent({
    contract: input.contract,
    runId: input.runId,
    input: input.input,
    status: "blocked",
    type: "tool.blocked",
    policyVerdict: input.finalVerdict,
    error: input.error.message,
    writeEvent: input.writeEvent,
  });
  const summary: RuntimeGateSummary = {
    mode: input.options.mode,
    toolName: input.contract.name,
    riskTier: input.contract.riskTier,
    status: "blocked",
    handlerExecuted: false,
    validationFailed: input.validationFailed === true,
    ...(input.finalVerdict ? { finalVerdict: input.finalVerdict } : {}),
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
  writeEvent: (event: Omit<ToolTraceEvent, "sequence">) => Promise<void>;
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
  return enforcement.riskTiers === undefined || enforcement.riskTiers.includes(contract.riskTier);
}

function isToolAllowed(contract: ToolContract, allowlist: readonly string[] | undefined): boolean {
  return allowlist === undefined || allowlist.includes(contract.name);
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
