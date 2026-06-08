export type {
  CreateEvidenceRecordOptions,
  EvidenceRecord,
  EvidenceRecordInput,
  EvidenceType,
} from "./evidence/evidence.js";
export {
  createEvidenceRecord,
  EvidenceRecordSchema,
  EvidenceTypeSchema,
} from "./evidence/evidence.js";
export type { ApprovalState, EvaluatePolicyInput } from "./policy/evaluate-policy.js";
export { ApprovalStateSchema, evaluatePolicy } from "./policy/evaluate-policy.js";
export type { PolicyConfig } from "./policy/policy-config.js";
export {
  createPolicyEvaluator,
  definePolicy,
  PolicyConfigSchema,
} from "./policy/policy-config.js";
export type {
  PolicyDiagnostic,
  PolicyDiagnosticSource,
  PolicyVerdict,
  PolicyVerdictStatus,
} from "./policy/verdict.js";
export {
  PolicyDiagnosticSchema,
  PolicyDiagnosticSourceSchema,
  PolicyVerdictSchema,
  PolicyVerdictStatusSchema,
} from "./policy/verdict.js";
export type { RedactValueOptions, SecretLeakFinding, SecretLeakKind } from "./redaction/redact.js";
export {
  assertNoSecretLikeValues,
  detectSecretLikeValues,
  redactValue,
  TraceGateSecretLeakError,
} from "./redaction/redact.js";
export type {
  CreateReplayExpectationOptions,
  ReplayComparisonResult,
  ReplayExpectation,
  ReplayFixture,
  ReplayFixtureInput,
  ReplayOutputKeysMode,
  ReplaySource,
  ReplayTraceSummary,
  TraceJsonlChunk,
} from "./replay/replay-fixture.js";
export {
  compareReplayExpectation,
  createReplayExpectation,
  defineReplayFixture,
  parseTraceJsonl,
  parseTraceJsonlStream,
  ReplayExpectationSchema,
  ReplayFixtureSchema,
  ReplayOutputKeysModeSchema,
  ReplayTraceSummarySchema,
  summarizeReplaySource,
} from "./replay/replay-fixture.js";
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
  ApprovalHandlerResult,
  CreateHarnessOptions,
  Harness,
  PolicyEvaluator,
  StartRunInput,
  ToolRuntimeContext,
  WrappedTool,
} from "./runtime/harness.js";
export { createHarness } from "./runtime/harness.js";
export type {
  EvidenceTraceEvent,
  MemoryTraceSink,
  RunTraceEvent,
  ToolTraceEvent,
  TraceEvent,
  TraceSink,
} from "./runtime/trace-sink.js";
export {
  createJsonlFileTraceSink,
  createMemoryTraceSink,
  EvidenceTraceEventSchema,
  RunTraceEventSchema,
  ToolTraceEventSchema,
  TraceEventSchema,
} from "./runtime/trace-sink.js";
export type { JsonObject, JsonValue } from "./schema/json.js";
export { JsonObjectSchema, JsonValueSchema } from "./schema/json.js";
export type {
  MatrixCase,
  MatrixCaseExpectation,
  MatrixCaseInput,
} from "./schema/matrix-case.js";
export {
  defineMatrix,
  MatrixCaseExpectationSchema,
  MatrixCaseSchema,
} from "./schema/matrix-case.js";
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
  MapRiskTierOptions,
  RiskTierMapping,
  ToolContractAdapter,
  ToolContractAdapterConfig,
  ToolContractManifestOverrides,
  ToolManifestValue,
} from "./schema/tool-contract-adapter.js";
export {
  createToolContractAdapter,
  defineToolContractFromManifest,
  mapRiskTier,
} from "./schema/tool-contract-adapter.js";
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
