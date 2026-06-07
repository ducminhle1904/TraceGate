export type { EvidenceRecord, EvidenceRecordInput, EvidenceType } from "./evidence/evidence.js";
export { EvidenceRecordSchema, EvidenceTypeSchema } from "./evidence/evidence.js";
export type { ApprovalState, EvaluatePolicyInput } from "./policy/evaluate-policy.js";
export { ApprovalStateSchema, evaluatePolicy } from "./policy/evaluate-policy.js";
export type { PolicyVerdict, PolicyVerdictStatus } from "./policy/verdict.js";
export { PolicyVerdictSchema, PolicyVerdictStatusSchema } from "./policy/verdict.js";
export type { RedactValueOptions } from "./redaction/redact.js";
export { redactValue } from "./redaction/redact.js";
export type { TraceGateRuntimeErrorDetails } from "./runtime/errors.js";
export {
  TraceGateInputValidationError,
  TraceGatePolicyBlockedError,
  TraceGateReviewRequiredError,
  TraceGateRuntimeError,
  TraceGateToolExecutionError,
} from "./runtime/errors.js";
export type {
  ApprovalHandler,
  CreateHarnessOptions,
  Harness,
  PolicyEvaluator,
  StartRunInput,
  ToolRuntimeContext,
  WrappedTool,
} from "./runtime/harness.js";
export { createHarness } from "./runtime/harness.js";
export type { MemoryTraceSink, TraceEvent, TraceSink } from "./runtime/trace-sink.js";
export {
  createJsonlFileTraceSink,
  createMemoryTraceSink,
} from "./runtime/trace-sink.js";
export type { JsonObject, JsonValue } from "./schema/json.js";
export { JsonObjectSchema, JsonValueSchema } from "./schema/json.js";
export type { MatrixCase, MatrixCaseExpectation } from "./schema/matrix-case.js";
export { MatrixCaseExpectationSchema, MatrixCaseSchema } from "./schema/matrix-case.js";
export type { Environment, HarnessContext, HarnessSurface } from "./schema/surface.js";
export {
  EnvironmentSchema,
  HarnessContextSchema,
  HarnessSurfaceSchema,
} from "./schema/surface.js";
export type {
  RiskTier,
  SideEffect,
  ToolContract,
  ToolContractConfig,
} from "./schema/tool-contract.js";
export {
  defineToolContract,
  RiskTierSchema,
  SideEffectSchema,
  ToolContractConfigSchema,
  ToolNameSchema,
} from "./schema/tool-contract.js";
export type {
  ToolCallRecord,
  ToolCallStatus,
  TraceGateRun,
  TraceGateRunStatus,
} from "./schema/trace.js";
export {
  ToolCallRecordSchema,
  ToolCallStatusSchema,
  TraceGateRunSchema,
  TraceGateRunStatusSchema,
} from "./schema/trace.js";
