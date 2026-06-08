import type { z } from "zod";

import type { JsonObject } from "./json.js";
import {
  defineToolContract,
  type RiskTier,
  RiskTierSchema,
  type SideEffect,
  type ToolContract,
  type ToolContractConfig,
} from "./tool-contract.js";

export type ToolManifestValue<TManifest, TValue> = TValue | ((manifest: TManifest) => TValue);

export type RiskTierMapping<TManifest = unknown> =
  | Record<string, RiskTier>
  | ((value: unknown, manifest: TManifest) => RiskTier);

export interface MapRiskTierOptions<TManifest = unknown> {
  fallback?: RiskTier;
  label?: string;
  manifest?: TManifest;
}

export interface ToolContractAdapterConfig<
  TManifest,
  TInputSchema extends z.ZodType<unknown> = z.ZodType<unknown>,
> {
  name: ToolManifestValue<TManifest, string>;
  riskTier: ToolManifestValue<TManifest, unknown>;
  inputSchema: ToolManifestValue<TManifest, TInputSchema>;
  riskMapping?: RiskTierMapping<TManifest>;
  fallbackRiskTier?: RiskTier;
  description?: ToolManifestValue<TManifest, string | undefined>;
  requiresApproval?: ToolManifestValue<TManifest, boolean | undefined>;
  sideEffects?: ToolManifestValue<TManifest, SideEffect[] | undefined>;
  requiredEvidence?: ToolManifestValue<TManifest, string[] | undefined>;
  metadata?: ToolManifestValue<TManifest, JsonObject | undefined>;
}

export type ToolContractManifestOverrides<
  TInputSchema extends z.ZodType<unknown> = z.ZodType<unknown>,
> = Partial<ToolContractConfig<TInputSchema>>;

export type ToolContractAdapter<
  TManifest,
  TInputSchema extends z.ZodType<unknown> = z.ZodType<unknown>,
> = (
  manifest: TManifest,
  overrides?: ToolContractManifestOverrides<TInputSchema>,
) => ToolContract<TInputSchema>;

export interface ManifestContractAdapterConfig<
  TManifest,
  TSchemaMap extends Record<string, z.ZodType<unknown>>,
> {
  registry: readonly TManifest[] | Record<string, TManifest>;
  schemas: TSchemaMap;
  riskMapping?: RiskTierMapping<TManifest>;
  fallbackRiskTier?: RiskTier;
  getName: (manifest: TManifest) => keyof TSchemaMap & string;
  getRiskTier: (manifest: TManifest) => unknown;
  getDescription?: (manifest: TManifest) => string | undefined;
  getApprovalRequirement?: (manifest: TManifest) => boolean | undefined;
  getSideEffects?: (manifest: TManifest) => SideEffect[] | undefined;
  getRequiredEvidence?: (manifest: TManifest) => string[] | undefined;
  getMetadata?: (manifest: TManifest) => JsonObject | undefined;
}

export type LooseManifestSchemaMap = Record<string, z.ZodTypeAny>;

export interface LooseManifestContractAdapterConfig<TManifest> {
  registry: readonly TManifest[] | Record<string, TManifest>;
  schemas: LooseManifestSchemaMap;
  riskMapping?: RiskTierMapping<TManifest>;
  fallbackRiskTier?: RiskTier;
  getName: (manifest: TManifest) => string;
  getRiskTier: (manifest: TManifest) => unknown;
  getDescription?: (manifest: TManifest) => string | undefined;
  getApprovalRequirement?: (manifest: TManifest) => boolean | undefined;
  getSideEffects?: (manifest: TManifest) => SideEffect[] | undefined;
  getRequiredEvidence?: (manifest: TManifest) => string[] | undefined;
  getMetadata?: (manifest: TManifest) => JsonObject | undefined;
}

export interface ManifestContractAdapter<
  _TManifest,
  TSchemaMap extends Record<string, z.ZodType<unknown>>,
> {
  readonly contracts: Record<string, ToolContract<TSchemaMap[keyof TSchemaMap]>>;
  getContract(name: keyof TSchemaMap & string): ToolContract<TSchemaMap[keyof TSchemaMap]>;
  defineContracts(): ToolContract<TSchemaMap[keyof TSchemaMap]>[];
}

export function mapRiskTier<TManifest = unknown>(
  value: unknown,
  mapping?: RiskTierMapping<TManifest>,
  options: MapRiskTierOptions<TManifest> = {},
): RiskTier {
  if (mapping === undefined) {
    const parsed = RiskTierSchema.safeParse(value);
    if (parsed.success) {
      return parsed.data;
    }
    return fallbackOrThrow(value, options);
  }

  if (typeof mapping === "function") {
    return RiskTierSchema.parse(mapping(value, options.manifest as TManifest));
  }

  const mapped = mapping[String(value)];
  if (mapped !== undefined) {
    return RiskTierSchema.parse(mapped);
  }

  return fallbackOrThrow(value, options, Object.keys(mapping));
}

export function createToolContractAdapter<
  TManifest,
  TInputSchema extends z.ZodType<unknown> = z.ZodType<unknown>,
>(
  config: ToolContractAdapterConfig<TManifest, TInputSchema>,
): ToolContractAdapter<TManifest, TInputSchema> {
  return (manifest, overrides = {}) => defineToolContractFromManifest(manifest, config, overrides);
}

export function createManifestContractAdapter<
  TManifest,
  TSchemaMap extends Record<string, z.ZodType<unknown>>,
>(
  config: ManifestContractAdapterConfig<TManifest, TSchemaMap>,
): ManifestContractAdapter<TManifest, TSchemaMap> {
  const manifests = Array.isArray(config.registry)
    ? config.registry
    : Object.values(config.registry);
  const contracts: Record<string, ToolContract<TSchemaMap[keyof TSchemaMap]>> = {};

  for (const manifest of manifests) {
    const name = config.getName(manifest);
    const schema = config.schemas[name];
    if (!schema) {
      throw new Error(`Missing input schema for tool manifest "${name}".`);
    }
    contracts[name] = defineToolContractFromManifest(manifest, {
      name,
      riskTier: config.getRiskTier,
      inputSchema: schema,
      ...(config.riskMapping ? { riskMapping: config.riskMapping } : {}),
      ...(config.fallbackRiskTier ? { fallbackRiskTier: config.fallbackRiskTier } : {}),
      ...(config.getDescription ? { description: config.getDescription } : {}),
      ...(config.getApprovalRequirement ? { requiresApproval: config.getApprovalRequirement } : {}),
      ...(config.getSideEffects ? { sideEffects: config.getSideEffects } : {}),
      ...(config.getRequiredEvidence ? { requiredEvidence: config.getRequiredEvidence } : {}),
      ...(config.getMetadata ? { metadata: config.getMetadata } : {}),
    });
  }

  return {
    contracts,
    getContract(name) {
      const contract = contracts[name];
      if (!contract) {
        throw new Error(`No TraceGate contract is defined for tool "${name}".`);
      }
      return contract;
    },
    defineContracts() {
      return Object.values(contracts);
    },
  };
}

export function createLooseManifestContractAdapter<TManifest>(
  config: LooseManifestContractAdapterConfig<TManifest>,
): ManifestContractAdapter<TManifest, LooseManifestSchemaMap> {
  return createManifestContractAdapter<TManifest, LooseManifestSchemaMap>(config);
}

export function defineToolContractFromManifest<
  TManifest,
  TInputSchema extends z.ZodType<unknown> = z.ZodType<unknown>,
>(
  manifest: TManifest,
  config: ToolContractAdapterConfig<TManifest, TInputSchema>,
  overrides: ToolContractManifestOverrides<TInputSchema> = {},
): ToolContract<TInputSchema> {
  const metadata = resolveOptional(config.metadata, manifest);
  const { metadata: overrideMetadata, ...restOverrides } = overrides;
  const riskTierOptions: MapRiskTierOptions<TManifest> = {
    label: "tool manifest risk tier",
    manifest,
  };
  if (config.fallbackRiskTier !== undefined) {
    riskTierOptions.fallback = config.fallbackRiskTier;
  }
  const contractConfig = {
    name: resolve(config.name, manifest),
    riskTier:
      restOverrides.riskTier ??
      mapRiskTier(resolve(config.riskTier, manifest), config.riskMapping, riskTierOptions),
    inputSchema: restOverrides.inputSchema ?? resolve(config.inputSchema, manifest),
    description: restOverrides.description ?? resolveOptional(config.description, manifest),
    requiresApproval:
      restOverrides.requiresApproval ?? resolveOptional(config.requiresApproval, manifest),
    sideEffects: restOverrides.sideEffects ?? resolveOptional(config.sideEffects, manifest),
    requiredEvidence:
      restOverrides.requiredEvidence ?? resolveOptional(config.requiredEvidence, manifest),
    ...restOverrides,
    metadata:
      metadata || overrideMetadata ? { ...(metadata ?? {}), ...(overrideMetadata ?? {}) } : {},
  };

  return defineToolContract(contractConfig);
}

function resolve<TManifest, TValue>(
  value: ToolManifestValue<TManifest, TValue>,
  manifest: TManifest,
): TValue {
  return typeof value === "function" ? (value as (manifest: TManifest) => TValue)(manifest) : value;
}

function resolveOptional<TManifest, TValue>(
  value: ToolManifestValue<TManifest, TValue> | undefined,
  manifest: TManifest,
): TValue | undefined {
  return value === undefined ? undefined : resolve(value, manifest);
}

function fallbackOrThrow<TManifest>(
  value: unknown,
  options: MapRiskTierOptions<TManifest>,
  knownValues: string[] = [],
): RiskTier {
  if (options.fallback !== undefined) {
    return RiskTierSchema.parse(options.fallback);
  }

  const label = options.label ?? "risk tier";
  const known =
    knownValues.length > 0 ? ` Known mapped values: ${knownValues.sort().join(", ")}.` : "";
  throw new Error(
    `Unknown ${label} "${String(value)}".${known} Provide a riskMapping entry or fallbackRiskTier.`,
  );
}
