import {
  defineToolContractFromManifest,
  type InferToolInput,
  type InferToolOutput,
  type JsonObject,
  type PreCallDecision,
  type RiskTierMapping,
  type RuntimeGateReconcileInput,
  type RuntimeGateSummary,
  type SideEffect,
  type ToolContract,
  type ToolSideEffectClass,
  type TraceGateInputSchema,
} from "@tracegate/core";

import {
  resolveDescription,
  resolveRuntimeGate,
  type TraceGateRuntimeAdapterOptions,
} from "./common.js";

export interface TraceGateFunctionTool<TInputSchema extends TraceGateInputSchema, TResult> {
  name: string;
  description: string;
  contract: ToolContract<TInputSchema>;
  execute(input: InferToolInput<TInputSchema>): Promise<TResult | unknown>;
}

export interface TraceGateClientFunctionTool<TInputSchema extends TraceGateInputSchema> {
  name: string;
  description: string;
  contract: ToolContract<TInputSchema>;
  preflight(input: InferToolInput<TInputSchema>): Promise<PreCallDecision>;
  reconcile(
    preflightOrId: PreCallDecision | string,
    result?: RuntimeGateReconcileInput,
  ): Promise<RuntimeGateSummary>;
}

export type TraceGateFunctionToolOptions = TraceGateRuntimeAdapterOptions;

export interface TraceGateFunctionRegistryEntry<
  TInputSchema extends TraceGateInputSchema = TraceGateInputSchema,
  TResult = unknown,
> {
  name?: string;
  description?: string;
  inputSchema: TInputSchema;
  riskTier: unknown;
  requiresApproval?: boolean;
  sideEffects?: SideEffect[];
  sideEffectClass?: ToolSideEffectClass;
  requiredEvidence?: string[];
  metadata?: JsonObject;
  execute(input: InferToolOutput<TInputSchema>): Promise<TResult> | TResult;
}

export interface TraceGateFunctionRegistryConfig<TEntry> {
  riskMapping?: RiskTierMapping<TEntry>;
  fallbackRiskTier?: ToolContract["riskTier"];
  getName?: (entry: TEntry, key: string) => string;
  getDescription?: (entry: TEntry, key: string) => string | undefined;
  getInputSchema?: (entry: TEntry, key: string) => TraceGateInputSchema;
  getRiskTier?: (entry: TEntry, key: string) => unknown;
  getApprovalRequirement?: (entry: TEntry, key: string) => boolean | undefined;
  getSideEffects?: (entry: TEntry, key: string) => SideEffect[] | undefined;
  getSideEffectClass?: (entry: TEntry, key: string) => ToolSideEffectClass | undefined;
  getRequiredEvidence?: (entry: TEntry, key: string) => string[] | undefined;
  getMetadata?: (entry: TEntry, key: string) => JsonObject | undefined;
  getExecute?: (
    entry: TEntry,
    key: string,
  ) => (input: InferToolOutput<TraceGateInputSchema>) => Promise<unknown> | unknown;
}

export function createTraceGateFunctionTool<TInputSchema extends TraceGateInputSchema, TResult>(
  contract: ToolContract<TInputSchema>,
  execute: (input: InferToolOutput<TInputSchema>) => Promise<TResult> | TResult,
  options: TraceGateFunctionToolOptions = {},
): TraceGateFunctionTool<TInputSchema, TResult> {
  const runtimeGate = resolveRuntimeGate(options);
  const wrapped = runtimeGate.wrapTool(contract, execute);

  return {
    name: contract.name,
    description: resolveDescription(options.description, contract.description, contract.name),
    contract,
    execute: wrapped,
  };
}

export function createTraceGateClientFunctionTool<TInputSchema extends TraceGateInputSchema>(
  contract: ToolContract<TInputSchema>,
  options: TraceGateFunctionToolOptions = {},
): TraceGateClientFunctionTool<TInputSchema> {
  const runtimeGate = resolveRuntimeGate(options);

  return {
    name: contract.name,
    description: resolveDescription(options.description, contract.description, contract.name),
    contract,
    preflight(input) {
      return runtimeGate.preflightToolCall(contract, input);
    },
    reconcile(preflightOrId, result) {
      return runtimeGate.reconcileToolCall(preflightOrId, result);
    },
  };
}

export function createTraceGateFunctionRegistry<
  TEntry extends TraceGateFunctionRegistryEntry,
  TRegistry extends Record<string, TEntry>,
>(
  registry: TRegistry,
  config: TraceGateFunctionRegistryConfig<TEntry> = {},
  options: TraceGateFunctionToolOptions = {},
): Record<keyof TRegistry & string, TraceGateFunctionTool<TraceGateInputSchema, unknown>> {
  const runtimeGate = resolveRuntimeGate(options);
  const toolOptions: TraceGateFunctionToolOptions = {
    runtimeGate,
    ...(options.description ? { description: options.description } : {}),
  };
  const tools = {} as Record<
    keyof TRegistry & string,
    TraceGateFunctionTool<TraceGateInputSchema, unknown>
  >;

  for (const [key, entry] of Object.entries(registry) as Array<
    [keyof TRegistry & string, TEntry]
  >) {
    const contract = defineToolContractFromManifest(entry, {
      name: (manifest: TEntry) => config.getName?.(manifest, key) ?? manifest.name ?? key,
      riskTier: (manifest: TEntry) => config.getRiskTier?.(manifest, key) ?? manifest.riskTier,
      inputSchema: (manifest: TEntry) =>
        config.getInputSchema?.(manifest, key) ?? manifest.inputSchema,
      ...(config.riskMapping ? { riskMapping: config.riskMapping } : {}),
      ...(config.fallbackRiskTier ? { fallbackRiskTier: config.fallbackRiskTier } : {}),
      description: (manifest: TEntry) =>
        config.getDescription?.(manifest, key) ?? manifest.description,
      requiresApproval: (manifest: TEntry) =>
        config.getApprovalRequirement?.(manifest, key) ?? manifest.requiresApproval,
      sideEffects: (manifest: TEntry) =>
        config.getSideEffects?.(manifest, key) ?? manifest.sideEffects,
      sideEffectClass: (manifest: TEntry) =>
        config.getSideEffectClass?.(manifest, key) ?? manifest.sideEffectClass,
      requiredEvidence: (manifest: TEntry) =>
        config.getRequiredEvidence?.(manifest, key) ?? manifest.requiredEvidence,
      metadata: (manifest: TEntry) => config.getMetadata?.(manifest, key) ?? manifest.metadata,
    });
    const execute =
      config.getExecute?.(entry, key) ??
      ((input: InferToolOutput<TraceGateInputSchema>) => entry.execute(input));
    tools[key] = createTraceGateFunctionTool(contract, execute, toolOptions);
  }

  return tools;
}
