import {
  createManifestContractAdapter,
  createToolContractAdapter,
  defineToolContractFromManifest,
  mapRiskTier,
} from "@tracegate/core";
import { z } from "zod";

type InternalRiskTier = "safe" | "broker_write" | "destructive";

interface InternalToolManifest {
  id: string;
  summary: string;
  internalRisk: InternalRiskTier;
  permissions: string[];
  schema: z.ZodType<unknown>;
  sideEffect?: {
    kind: string;
    external: boolean;
  };
}

const riskMapping = {
  safe: "read",
  broker_write: "high",
  destructive: "critical",
} as const;

const toolManifests: InternalToolManifest[] = [
  {
    id: "lookupOrder",
    summary: "Read order status",
    internalRisk: "safe",
    permissions: [],
    schema: z.object({ orderId: z.string() }),
  },
  {
    id: "submitBrokerOrder",
    summary: "Place a broker order",
    internalRisk: "broker_write",
    permissions: ["trade-ticket"],
    schema: z.object({ symbol: z.string(), quantity: z.number().positive() }),
    sideEffect: { kind: "broker-order", external: true },
  },
];

const fromInternalManifest = createToolContractAdapter<InternalToolManifest>({
  name: (manifest: InternalToolManifest) => manifest.id,
  description: (manifest: InternalToolManifest) => manifest.summary,
  riskTier: (manifest: InternalToolManifest) => manifest.internalRisk,
  riskMapping,
  requiresApproval: (manifest: InternalToolManifest) => manifest.internalRisk !== "safe",
  inputSchema: (manifest: InternalToolManifest) => manifest.schema,
  requiredEvidence: (manifest: InternalToolManifest) => manifest.permissions,
  sideEffects: (manifest: InternalToolManifest) =>
    manifest.sideEffect ? [manifest.sideEffect] : [],
  metadata: (manifest: InternalToolManifest) => ({ internalRisk: manifest.internalRisk }),
});

const contracts = toolManifests.map((manifest) => fromInternalManifest(manifest));
const readOnlyContract = contracts[0];
const brokerWriteContract = contracts[1];
const overridden = defineToolContractFromManifest(
  toolManifests[1] as InternalToolManifest,
  {
    name: (manifest: InternalToolManifest) => manifest.id,
    riskTier: (manifest: InternalToolManifest) => manifest.internalRisk,
    riskMapping,
    inputSchema: (manifest: InternalToolManifest) => manifest.schema,
    metadata: (manifest: InternalToolManifest) => ({ internalRisk: manifest.internalRisk }),
  },
  {
    requiredEvidence: ["manager-approval", "trade-ticket"],
    metadata: { owner: "risk" },
  },
);

const nodeTraderLikeSchemas = {
  readPosition: z.object({ symbol: z.string() }),
  placeOrder: z.object({ symbol: z.string(), quantity: z.number().positive() }),
};

type NodeTraderLikeRiskTier =
  | "read"
  | "draft"
  | "canvas_mutation"
  | "persisted_write"
  | "trading_action"
  | "admin_action";

interface NodeTraderLikeManifest {
  name: keyof typeof nodeTraderLikeSchemas;
  description: string;
  policy: {
    riskTier: NodeTraderLikeRiskTier;
    permission: string;
  };
  executionLocation: string;
}

const nodeTraderLikeRegistry: NodeTraderLikeManifest[] = [
  {
    name: "readPosition",
    description: "Read current position",
    policy: { riskTier: "read", permission: "portfolio:read" },
    executionLocation: "server",
  },
  {
    name: "placeOrder",
    description: "Place a live order",
    policy: { riskTier: "trading_action", permission: "orders:write" },
    executionLocation: "broker",
  },
];

const nodeTraderLikeAdapter = createManifestContractAdapter({
  registry: nodeTraderLikeRegistry,
  schemas: nodeTraderLikeSchemas,
  getName: (manifest) => manifest.name,
  getDescription: (manifest) => manifest.description,
  getRiskTier: (manifest) => manifest.policy.riskTier,
  riskMapping: {
    read: "read",
    draft: "medium",
    canvas_mutation: "medium",
    persisted_write: "medium",
    trading_action: "high",
    admin_action: "critical",
  },
  getApprovalRequirement: (manifest) =>
    manifest.policy.riskTier === "trading_action" || manifest.policy.riskTier === "admin_action",
  getRequiredEvidence: (manifest) => [manifest.policy.permission],
  getMetadata: (manifest) => ({
    permission: manifest.policy.permission,
    executionLocation: manifest.executionLocation,
  }),
});

const placeOrderContract = nodeTraderLikeAdapter.getContract("placeOrder");

assertEqual(mapRiskTier("broker_write", riskMapping), "high", "broker_write risk mapping");
assertEqual(readOnlyContract?.requiresApproval, false, "read-only approval requirement");
assertEqual(brokerWriteContract?.riskTier, "high", "broker-write TraceGate risk tier");
assertEqual(brokerWriteContract?.requiresApproval, true, "broker-write approval requirement");
assertJsonEqual(
  brokerWriteContract?.requiredEvidence,
  ["trade-ticket"],
  "broker-write required evidence",
);
assertJsonEqual(
  brokerWriteContract?.sideEffects,
  [{ kind: "broker-order", external: true }],
  "broker-write side effects",
);
assertJsonEqual(
  overridden.metadata,
  { internalRisk: "broker_write", owner: "risk" },
  "override metadata merge",
);
assertEqual(placeOrderContract.riskTier, "high", "NodeTrader-like trading risk mapping");
assertJsonEqual(
  placeOrderContract.requiredEvidence,
  ["orders:write"],
  "NodeTrader-like required evidence",
);

console.log(
  JSON.stringify(
    {
      mappedRisk: mapRiskTier("broker_write", riskMapping),
      contracts: contracts.map((contract) => ({
        name: contract.name,
        riskTier: contract.riskTier,
        requiresApproval: contract.requiresApproval,
        requiredEvidence: contract.requiredEvidence,
        sideEffects: contract.sideEffects,
        metadata: contract.metadata,
      })),
      overridden: {
        name: overridden.name,
        requiredEvidence: overridden.requiredEvidence,
        metadata: overridden.metadata,
      },
      nodeTraderLike: {
        name: placeOrderContract.name,
        riskTier: placeOrderContract.riskTier,
        requiredEvidence: placeOrderContract.requiredEvidence,
        metadata: placeOrderContract.metadata,
      },
    },
    null,
    2,
  ),
);

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertJsonEqual(actual: unknown, expected: unknown, label: string): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${label}: expected ${expectedJson}, got ${actualJson}`);
  }
}
