import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  assertNoSecretLikeValues,
  compareReplayExpectation,
  createEvidenceRecord,
  createLooseManifestContractAdapter,
  createPolicyEvaluator,
  createReplayExpectation,
  createToolContractAdapter,
  defineMatrix,
  definePolicy,
  defineReplayFixture,
  defineToolContract,
  defineToolContractFromManifest,
  detectSecretLikeValues,
  EvidenceRecordSchema,
  evaluatePolicy,
  MatrixCaseSchema,
  mapRiskTier,
  parseTraceJsonl,
  parseTraceJsonlStream,
  redactValue,
  ToolCallRecordSchema,
  TraceGateRunSchema,
  TraceGateSecretLeakError,
} from "../src/index.js";

const EmailInputSchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1),
  body: z.string().min(1),
});

describe("defineToolContract", () => {
  it("parses a valid tool contract and preserves the Zod input schema", () => {
    const contract = defineToolContract({
      name: "sendEmail",
      riskTier: "high",
      requiresApproval: true,
      inputSchema: EmailInputSchema,
      requiredEvidence: ["approval"],
    });

    expect(contract.name).toBe("sendEmail");
    expect(contract.riskTier).toBe("high");
    expect(
      contract.inputSchema.safeParse({ to: "a@example.com", subject: "Hi", body: "Body" }).success,
    ).toBe(true);
    expect(
      contract.inputSchema.safeParse({ to: "not-email", subject: "Hi", body: "Body" }).success,
    ).toBe(false);
  });

  it("rejects invalid contract names and risk tiers", () => {
    expect(() =>
      defineToolContract({
        name: "send email",
        riskTier: "high",
        inputSchema: EmailInputSchema,
      }),
    ).toThrow();

    expect(() =>
      defineToolContract({
        name: "sendEmail",
        riskTier: "severe" as never,
        inputSchema: EmailInputSchema,
      }),
    ).toThrow();

    expect(() =>
      defineToolContract({
        name: "fakeTool",
        riskTier: "low",
        inputSchema: { safeParse: () => ({ success: true }) } as never,
      }),
    ).toThrow();
  });
});

describe("tool contract manifest adapters", () => {
  type InternalToolManifest = {
    id: string;
    summary: string;
    internalRisk: "safe" | "broker_write" | "destructive";
    permissions: string[];
    schema: typeof EmailInputSchema;
    sideEffectKind?: string;
  };

  const manifest: InternalToolManifest = {
    id: "notifyCustomer",
    summary: "Send a customer notification",
    internalRisk: "broker_write",
    permissions: ["customer-email"],
    schema: EmailInputSchema,
    sideEffectKind: "email",
  };

  it("maps custom manifest fields into a typed tool contract", () => {
    const adapter = createToolContractAdapter<InternalToolManifest, typeof EmailInputSchema>({
      name: (tool) => tool.id,
      description: (tool: InternalToolManifest) => tool.summary,
      riskTier: (tool: InternalToolManifest) => tool.internalRisk,
      riskMapping: {
        safe: "read",
        broker_write: "high",
        destructive: "critical",
      },
      requiresApproval: (tool: InternalToolManifest) => tool.internalRisk !== "safe",
      inputSchema: (tool: InternalToolManifest) => tool.schema,
      requiredEvidence: (tool: InternalToolManifest) => tool.permissions,
      sideEffects: (tool: InternalToolManifest) =>
        tool.sideEffectKind ? [{ kind: tool.sideEffectKind, external: true }] : [],
      metadata: (tool: InternalToolManifest) => ({
        source: "internal-registry",
        internalRisk: tool.internalRisk,
      }),
    });

    const contract = adapter(manifest);

    expect(contract).toMatchObject({
      name: "notifyCustomer",
      description: "Send a customer notification",
      riskTier: "high",
      requiresApproval: true,
      requiredEvidence: ["customer-email"],
      sideEffects: [{ kind: "email", external: true }],
      metadata: { source: "internal-registry", internalRisk: "broker_write" },
    });
    expect(
      contract.inputSchema.safeParse({ to: "a@example.com", subject: "Hi", body: "Body" }).success,
    ).toBe(true);
  });

  it("supports direct conversion and overrides without mutating the manifest", () => {
    const contract = defineToolContractFromManifest<InternalToolManifest, typeof EmailInputSchema>(
      manifest,
      {
        name: (tool: InternalToolManifest) => tool.id,
        riskTier: (tool: InternalToolManifest) => tool.internalRisk,
        riskMapping: (value) => (value === "broker_write" ? "medium" : "read"),
        inputSchema: (tool) => tool.schema,
        metadata: (tool) => ({ internalRisk: tool.internalRisk }),
      },
      {
        description: "Overridden description",
        requiredEvidence: ["manager-approval"],
        metadata: { release: "0.0.3" },
      },
    );

    expect(contract).toMatchObject({
      description: "Overridden description",
      riskTier: "medium",
      requiredEvidence: ["manager-approval"],
      metadata: { internalRisk: "broker_write", release: "0.0.3" },
    });
    expect(manifest.permissions).toEqual(["customer-email"]);
  });

  it("supports static and functional manifest adapter fields without mutating metadata", () => {
    const manifestMetadata = { registry: "generic-zod", internalRisk: manifest.internalRisk };
    const adapter = createToolContractAdapter<InternalToolManifest, typeof EmailInputSchema>({
      name: "staticNotifyCustomer",
      description: "Static descriptor",
      riskTier: (tool: InternalToolManifest) => tool.internalRisk,
      riskMapping: { broker_write: "high" },
      inputSchema: (tool: InternalToolManifest) => tool.schema,
      requiresApproval: true,
      requiredEvidence: ["static-approval"],
      sideEffects: [{ kind: "email", external: true }],
      metadata: () => manifestMetadata,
    });

    const contract = adapter(manifest, { metadata: { override: "kept" } });

    expect(contract).toMatchObject({
      name: "staticNotifyCustomer",
      description: "Static descriptor",
      riskTier: "high",
      requiresApproval: true,
      requiredEvidence: ["static-approval"],
      metadata: { registry: "generic-zod", internalRisk: "broker_write", override: "kept" },
    });
    expect(manifestMetadata).toEqual({ registry: "generic-zod", internalRisk: "broker_write" });
  });

  it("fails clearly for unknown custom risk tiers unless a fallback is explicit", () => {
    expect(() => mapRiskTier("broker_write", { safe: "read" })).toThrow(
      'Unknown risk tier "broker_write". Known mapped values: safe.',
    );
    expect(mapRiskTier("broker_write", { safe: "read" }, { fallback: "high" })).toBe("high");
  });

  it("builds contracts from loose schema maps for complex registries", () => {
    type RegistryManifest = {
      name: string;
      description: string;
      policy: {
        riskTier:
          | "read"
          | "draft"
          | "canvas_mutation"
          | "persisted_write"
          | "trading_action"
          | "admin_action";
        permission: string;
      };
      executionLocation: "client" | "server";
    };
    const registry: RegistryManifest[] = [
      {
        name: "placeOrder",
        description: "Place an order through the broker",
        policy: { riskTier: "trading_action", permission: "broker:trade" },
        executionLocation: "server",
      },
    ];
    const schemas: Record<string, z.ZodTypeAny> = {
      placeOrder: z.object({ symbol: z.string(), size: z.number().positive() }),
    };

    const adapter = createLooseManifestContractAdapter({
      registry,
      schemas,
      getName: (tool) => tool.name,
      getDescription: (tool) => tool.description,
      getRiskTier: (tool) => tool.policy.riskTier,
      riskMapping: {
        read: "read",
        draft: "medium",
        canvas_mutation: "medium",
        persisted_write: "medium",
        trading_action: "high",
        admin_action: "critical",
      },
      getApprovalRequirement: (tool) => tool.policy.riskTier === "trading_action",
      getRequiredEvidence: (tool) => [tool.policy.permission],
      getMetadata: (tool) => ({
        repoRiskTier: tool.policy.riskTier,
        executionLocation: tool.executionLocation,
      }),
    });

    expect(adapter.getContract("placeOrder")).toMatchObject({
      name: "placeOrder",
      riskTier: "high",
      requiresApproval: true,
      requiredEvidence: ["broker:trade"],
      metadata: {
        repoRiskTier: "trading_action",
        executionLocation: "server",
      },
    });
  });

  it("fails clearly when a loose manifest adapter schema is missing", () => {
    expect(() =>
      createLooseManifestContractAdapter({
        registry: [{ name: "missingSchema", risk: "read" }],
        schemas: {},
        getName: (tool) => tool.name,
        getRiskTier: (tool) => tool.risk,
      }),
    ).toThrow('Missing input schema for tool manifest "missingSchema".');
  });
});

describe("evaluatePolicy", () => {
  const highRiskContract = defineToolContract({
    name: "issueRefund",
    riskTier: "high",
    requiresApproval: true,
    inputSchema: z.object({ orderId: z.string(), amount: z.number().positive() }),
  });

  it("returns review when approval is missing", () => {
    expect(evaluatePolicy({ contract: highRiskContract })).toMatchObject({
      status: "review",
      toolName: "issueRefund",
      riskTier: "high",
      diagnostics: [
        {
          source: "contract",
          rule: "approval-missing",
          approval: "missing",
        },
      ],
    });
  });

  it("returns block when approval is denied", () => {
    expect(evaluatePolicy({ contract: highRiskContract, approval: "denied" })).toMatchObject({
      status: "block",
      toolName: "issueRefund",
      diagnostics: [
        {
          source: "contract",
          rule: "approval-denied",
          approval: "denied",
        },
      ],
    });
  });

  it("returns allow when approval is present", () => {
    expect(evaluatePolicy({ contract: highRiskContract, approval: "approved" })).toMatchObject({
      status: "allow",
      toolName: "issueRefund",
    });
  });

  it("returns allow when a contract does not require approval", () => {
    const readContract = defineToolContract({
      name: "lookupOrder",
      riskTier: "read",
      inputSchema: z.object({ orderId: z.string() }),
    });

    expect(evaluatePolicy({ contract: readContract })).toMatchObject({
      status: "allow",
      toolName: "lookupOrder",
    });
  });

  it("returns block when approval is denied even if approval is not required", () => {
    const readContract = defineToolContract({
      name: "lookupOrder",
      riskTier: "read",
      inputSchema: z.object({ orderId: z.string() }),
    });

    expect(evaluatePolicy({ contract: readContract, approval: "denied" })).toMatchObject({
      status: "block",
      toolName: "lookupOrder",
    });
  });
});

describe("policy configuration", () => {
  const refundContract = defineToolContract({
    name: "issueRefund",
    riskTier: "high",
    inputSchema: z.object({ orderId: z.string(), amount: z.number().positive() }),
  });

  it("requires approval for configured risk tiers", () => {
    const evaluator = createPolicyEvaluator(
      definePolicy({ requireApprovalForRiskTiers: ["high", "critical"] }),
    );

    expect(evaluator({ contract: refundContract })).toMatchObject({ status: "review" });
    expect(evaluator({ contract: refundContract, approval: "approved" })).toMatchObject({
      status: "allow",
    });
  });

  it("lets tool overrides beat environment and base policy", () => {
    const evaluator = createPolicyEvaluator(
      definePolicy({
        requireApprovalForRiskTiers: ["high"],
        environmentOverrides: {
          production: {
            blockRiskTiers: ["high"],
          },
        },
        toolOverrides: {
          issueRefund: {
            requireApprovalForRiskTiers: ["high"],
            blockRiskTiers: [],
          },
        },
      }),
    );

    expect(
      evaluator({
        contract: refundContract,
        approval: "approved",
        environment: "production",
      }),
    ).toMatchObject({ status: "allow" });
  });

  it("rejects mistyped environment override names", () => {
    expect(() =>
      definePolicy({
        environmentOverrides: {
          prodution: {
            blockRiskTiers: ["critical"],
          },
        } as never,
      }),
    ).toThrow();
  });

  it("blocks denied approval regardless of risk tier", () => {
    const evaluator = createPolicyEvaluator(definePolicy({}));
    const readContract = defineToolContract({
      name: "lookupOrder",
      riskTier: "read",
      inputSchema: z.object({ orderId: z.string() }),
    });

    expect(evaluator({ contract: readContract, approval: "denied" })).toMatchObject({
      status: "block",
    });
  });

  it("exposes policy rule diagnostics for blocked risk tiers", () => {
    const evaluator = createPolicyEvaluator(definePolicy({ blockRiskTiers: ["high"] }));

    expect(evaluator({ contract: refundContract })).toMatchObject({
      status: "block",
      diagnostics: [
        {
          source: "policy",
          rule: "blocked-risk-tier",
          riskTier: "high",
        },
      ],
    });
  });

  it("reviews missing evidence and allows approved calls with evidence", () => {
    const evaluator = createPolicyEvaluator(
      definePolicy({
        requireApprovalForRiskTiers: ["high"],
        requiredEvidence: {
          issueRefund: ["manager"],
        },
      }),
    );
    const evidence = [
      EvidenceRecordSchema.parse({
        id: "approval-1",
        type: "user-approval",
        timestamp: "2026-06-07T00:00:00.000Z",
        content: { approvedBy: "manager" },
      }),
    ];

    expect(evaluator({ contract: refundContract, approval: "approved" })).toMatchObject({
      status: "review",
    });
    expect(evaluator({ contract: refundContract, approval: "approved", evidence })).toMatchObject({
      status: "allow",
    });
  });

  it("adds required evidence across base and environment policies", () => {
    const evaluator = createPolicyEvaluator(
      definePolicy({
        requiredEvidence: {
          issueRefund: ["audit"],
        },
        environmentOverrides: {
          production: {
            requiredEvidence: {
              issueRefund: ["manager"],
            },
          },
        },
      }),
    );
    const auditEvidence = EvidenceRecordSchema.parse({
      id: "audit-1",
      type: "system",
      timestamp: "2026-06-07T00:00:00.000Z",
      content: { type: "audit" },
    });
    const managerEvidence = EvidenceRecordSchema.parse({
      id: "approval-1",
      type: "user-approval",
      timestamp: "2026-06-07T00:00:00.000Z",
      content: { approvedBy: "manager" },
    });

    expect(
      evaluator({
        contract: refundContract,
        environment: "production",
        evidence: [auditEvidence],
      }),
    ).toMatchObject({ status: "review" });
    expect(
      evaluator({
        contract: refundContract,
        environment: "production",
        evidence: [auditEvidence, managerEvidence],
      }),
    ).toMatchObject({ status: "allow" });
  });
});

describe("trace, evidence, and matrix schemas", () => {
  const timestamp = "2026-06-07T00:00:00.000Z";

  it("parses valid JSON-friendly records", () => {
    const verdict = {
      status: "allow",
      reasons: ["Required approval is present."],
      riskTier: "high",
      toolName: "sendEmail",
    };

    const toolCall = ToolCallRecordSchema.parse({
      id: "call-1",
      runId: "run-1",
      toolName: "sendEmail",
      timestamp,
      status: "succeeded",
      riskTier: "high",
      input: { to: "a@example.com" },
      output: { sent: true },
      policyVerdict: verdict,
    });

    const evidence = EvidenceRecordSchema.parse({
      id: "evidence-1",
      type: "user-approval",
      timestamp,
      content: { approvedBy: "manager" },
    });

    const run = TraceGateRunSchema.parse({
      id: "run-1",
      startedAt: timestamp,
      status: "succeeded",
      toolCalls: [toolCall],
      evidence: [evidence],
    });

    const matrixCase = MatrixCaseSchema.parse({
      id: "blocks-email-without-approval",
      prompt: "Send an email",
      expect: {
        forbiddenTools: ["sendEmail"],
        requiredPolicyVerdict: "block",
        toolInputIncludes: {
          sendEmail: { to: "a@example.com" },
        },
      },
    });

    expect(run.toolCalls).toHaveLength(1);
    expect(matrixCase.expect.forbiddenTools).toEqual(["sendEmail"]);
    expect(matrixCase.expect.toolInputIncludes?.sendEmail).toEqual({ to: "a@example.com" });
  });

  it("defines a parsed matrix case list", () => {
    const matrix = defineMatrix([
      {
        id: "requires-lookup",
        prompt: "Look up this order",
        expect: {
          requiredTools: ["lookupOrder"],
        },
      },
    ]);

    expect(matrix).toHaveLength(1);
    expect(matrix[0]?.expect.requiredTools).toEqual(["lookupOrder"]);
  });

  it("rejects malformed required fields", () => {
    expect(() => ToolCallRecordSchema.parse({ id: "call-1" })).toThrow();
    expect(() =>
      EvidenceRecordSchema.parse({ id: "evidence-1", type: "unknown", timestamp }),
    ).toThrow();
    expect(() => MatrixCaseSchema.parse({ id: "case-1", prompt: "" })).toThrow();
  });

  it("creates evidence records with an auto-filled timestamp", () => {
    expect(
      createEvidenceRecord(
        {
          id: "evidence-auto",
          type: "system",
          content: { signal: "ready" },
        },
        { now: () => "2026-06-08T00:00:00.000Z" },
      ),
    ).toMatchObject({
      id: "evidence-auto",
      timestamp: "2026-06-08T00:00:00.000Z",
    });
  });
});

describe("redactValue", () => {
  it("redacts configured and secret-like keys while preserving safe fields", () => {
    expect(
      redactValue(
        {
          email: "a@example.com",
          token: "secret-token",
          nested: {
            apiKey: "secret-api-key",
            keep: "visible",
            customerEmail: "sensitive@example.com",
          },
        },
        { keys: ["customerEmail"] },
      ),
    ).toEqual({
      email: "a@example.com",
      token: "[REDACTED]",
      nested: {
        apiKey: "[REDACTED]",
        keep: "visible",
        customerEmail: "[REDACTED]",
      },
    });
  });

  it("redacts secret-like string values with deterministic patterns", () => {
    expect(
      redactValue({
        authorization: "Bearer should-be-redacted-by-key",
        note: "send Bearer abcdefghijklmnopqrstuvwxyz to the API",
        custom: "customer-secret-123",
      }),
    ).toEqual({
      authorization: "[REDACTED]",
      note: "send [REDACTED] to the API",
      custom: "customer-secret-123",
    });

    expect(
      redactValue(
        { note: "token custom-secret-123" },
        { patterns: [/custom-secret-\d+/], preserveLength: true },
      ),
    ).toEqual({ note: "token *****************" });
  });

  it("detects and throws for secret-like values", () => {
    const value = {
      nested: {
        note: "Bearer abcdefghijklmnopqrstuvwxyz",
      },
    };

    expect(detectSecretLikeValues(value)).toEqual([
      {
        kind: "bearer-token",
        path: "nested.note",
        preview: "[secret-like:33]",
      },
    ]);
    expect(() => assertNoSecretLikeValues(value)).toThrow(TraceGateSecretLeakError);
  });

  it("detects secret-like keys and honors detection options", () => {
    expect(
      detectSecretLikeValues({ customerEmail: "a@example.com" }, { keys: ["customerEmail"] }),
    ).toEqual([
      {
        kind: "secret-key",
        path: "customerEmail",
        preview: "[secret-like:13]",
      },
    ]);
    expect(detectSecretLikeValues({ token: "secret-token" }, { detect: false })).toEqual([]);
  });

  it("can ignore configured redaction placeholders on secret-like keys", () => {
    const redacted = {
      credentials: [
        {
          apiKey: "[REDACTED]",
          password: "[redacted]",
          authorization: "***",
          cookie: "<hidden>",
        },
      ],
      token: "raw-token",
    };

    expect(detectSecretLikeValues(redacted).map((finding) => finding.path)).toEqual([
      "credentials[0].apiKey",
      "credentials[0].password",
      "credentials[0].authorization",
      "credentials[0].cookie",
      "token",
    ]);
    expect(
      detectSecretLikeValues(redacted, {
        ignoreRedactionPlaceholders: true,
        redactionPlaceholders: ["<hidden>"],
      }),
    ).toEqual([
      {
        kind: "secret-key",
        path: "token",
        preview: "[secret-like:9]",
      },
    ]);
    expect(() =>
      assertNoSecretLikeValues(
        { apiKey: "<hidden>" },
        { ignoreRedactionPlaceholders: true, redactionPlaceholders: ["<hidden>"] },
      ),
    ).not.toThrow();
  });

  it("redacts segmented API keys", () => {
    const value = { note: "use sk-proj-1234567890abcdef1234567890abcdef" };

    expect(redactValue(value)).toEqual({ note: "use [REDACTED]" });
    expect(detectSecretLikeValues(value)).toEqual([
      {
        kind: "api-key",
        path: "note",
        preview: "[secret-like:44]",
      },
    ]);
  });
});

describe("replay fixtures", () => {
  const timestamp = "2026-06-07T00:00:00.000Z";
  const toolEvent = {
    sequence: 1,
    type: "tool.started",
    timestamp,
    runId: "run-1",
    record: {
      id: "tool-1",
      runId: "run-1",
      toolName: "sendEmail",
      timestamp,
      status: "started",
      riskTier: "high",
      policyVerdict: {
        status: "review",
        reasons: ["approval required"],
        riskTier: "high",
        toolName: "sendEmail",
      },
    },
  };
  const evidenceEvent = {
    sequence: 2,
    type: "evidence.recorded",
    timestamp,
    runId: "run-1",
    record: {
      id: "approval-1",
      type: "user-approval",
      timestamp,
      content: { approvedBy: "manager" },
    },
  };

  it("parses JSONL trace events and builds replay expectations", () => {
    const events = parseTraceJsonl(
      `${JSON.stringify(toolEvent)}\n${JSON.stringify(evidenceEvent)}\n`,
    );
    const expectation = createReplayExpectation({
      events,
      output: { blocked: true, nested: { reason: "approval" } },
    });

    expect(events).toHaveLength(2);
    expect(expectation).toMatchObject({
      toolSequence: ["sendEmail"],
      toolStatuses: { sendEmail: ["started"] },
      policyVerdicts: { sendEmail: ["review"] },
      evidence: [{ id: "approval-1", type: "user-approval" }],
      outputKeys: ["blocked", "nested", "nested.reason"],
      traceEventCount: 2,
    });
  });

  it("rejects malformed JSONL rows with line context", () => {
    expect(() => parseTraceJsonl(`${JSON.stringify(toolEvent)}\nnot-json`)).toThrow("line 2");
    expect(() => parseTraceJsonl('{"type":"tool.started"}')).toThrow("line 1");
  });

  it("streams JSONL trace events with the same semantics as in-memory parsing", async () => {
    const trace = `\n${JSON.stringify(toolEvent)}\n\n${JSON.stringify(evidenceEvent)}\n`;

    await expect(
      parseTraceJsonlStream(chunks(trace.slice(0, 10), trace.slice(10))),
    ).resolves.toEqual(parseTraceJsonl(trace));
  });

  it("streams JSONL parse failures with line context", async () => {
    await expect(
      parseTraceJsonlStream(chunks(`${JSON.stringify(toolEvent)}\nnot-json`)),
    ).rejects.toThrow("line 2");
    await expect(parseTraceJsonlStream(chunks('{"type":"tool.started"}'))).rejects.toThrow(
      "line 1",
    );
  });

  it("summarizes partial traces from tool events instead of run.started snapshots", () => {
    const runStartedEvent = {
      sequence: 0,
      type: "run.started",
      timestamp,
      runId: "run-1",
      run: {
        id: "run-1",
        startedAt: timestamp,
        status: "running",
        toolCalls: [],
        evidence: [],
      },
    };
    const events = parseTraceJsonl(
      `${JSON.stringify(runStartedEvent)}\n${JSON.stringify(toolEvent)}\n${JSON.stringify(evidenceEvent)}\n`,
    );

    expect(createReplayExpectation({ events })).toMatchObject({
      toolSequence: ["sendEmail"],
      toolStatuses: { sendEmail: ["started"] },
      policyVerdicts: { sendEmail: ["review"] },
      evidence: [{ id: "approval-1", type: "user-approval" }],
    });
  });

  it("derives run-only tool sequence from started records only", () => {
    const startedRecord = ToolCallRecordSchema.parse(toolEvent.record);
    const succeededRecord = ToolCallRecordSchema.parse({
      ...toolEvent.record,
      id: "tool-2",
      status: "succeeded",
    });

    expect(
      createReplayExpectation({
        run: {
          id: "run-1",
          startedAt: timestamp,
          status: "succeeded",
          toolCalls: [startedRecord, succeededRecord],
          evidence: [],
        },
      }),
    ).toMatchObject({
      toolSequence: ["sendEmail"],
      toolStatuses: { sendEmail: ["started", "succeeded"] },
    });
  });

  it("defines replay fixtures and detects drift", () => {
    const events = parseTraceJsonl(
      `${JSON.stringify(toolEvent)}\n${JSON.stringify(evidenceEvent)}\n`,
    );
    const fixture = defineReplayFixture({
      version: "1",
      id: "blocks-email-without-approval",
      case: {
        id: "blocks-email-without-approval",
        prompt: "Send email",
        expect: {},
      },
      captured: {
        traceEventCount: events.length,
      },
      expect: createReplayExpectation({ events, output: { blocked: true } }),
    });

    expect(
      compareReplayExpectation(fixture.expect, { events, output: { blocked: true } }).failures,
    ).toEqual([]);
    expect(
      compareReplayExpectation(fixture.expect, {
        events: events.slice(0, 1),
        output: {},
      }).failures,
    ).toEqual(
      expect.arrayContaining([
        "Expected evidence [approval-1:user-approval], got [].",
        expect.stringContaining("Expected output keys [blocked]"),
      ]),
    );
  });

  it("supports subset replay output key expectations", () => {
    const expected = createReplayExpectation(
      { output: { answer: "ok" } },
      { outputKeysMode: "subset" },
    );

    const comparison = compareReplayExpectation(expected, {
      output: { answer: "ok", citations: ["doc-1"], meta: { latencyMs: 12 } },
    });
    expect(comparison.failures).toEqual([]);
    expect(comparison.actual.outputKeysMode).toBe("exact");
    expect(
      compareReplayExpectation(expected, { output: { citations: ["doc-1"] } }).failures,
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("subset mode allows extra output keys"),
        expect.stringContaining("Missing: [answer]"),
      ]),
    );
  });

  it("supports ignored and optional replay output keys in exact mode", () => {
    const expected = createReplayExpectation(
      {
        output: {
          answer: "ok",
          citations: ["doc-1"],
          meta: { traceId: "run-1", latencyMs: 12 },
        },
      },
      {
        ignoredOutputKeys: ["meta.traceId"],
        optionalOutputKeys: ["citations", "meta.latencyMs"],
      },
    );

    expect(
      compareReplayExpectation(expected, {
        output: { answer: "ok" },
      }).failures,
    ).toEqual([]);
    expect(
      compareReplayExpectation(expected, {
        output: { answer: "ok", meta: { traceId: "run-2" }, extra: true },
      }).failures,
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("exact mode rejects extra output keys"),
        expect.stringContaining("Unexpected: [extra]"),
        expect.stringContaining("Ignored: [meta.traceId]"),
        expect.stringContaining("Optional: [citations, meta.latencyMs]"),
      ]),
    );
  });

  it("supports absent output keys and path value assertions", () => {
    const expected = createReplayExpectation(
      {
        output: {
          answer: "ok",
          metrics: { latencyMs: 12 },
          redacted: "[REDACTED]",
        },
      },
      {
        outputKeysMode: "subset",
        ignoredOutputKeys: ["metrics.latencyMs"],
        absentOutputKeys: ["debug.rawSecret"],
        outputValues: {
          answer: "ok",
          redacted: "[REDACTED]",
        },
      },
    );

    expect(
      compareReplayExpectation(expected, {
        output: {
          answer: "ok",
          metrics: { latencyMs: 99, tokens: 12 },
          redacted: "[REDACTED]",
          extra: true,
        },
      }).failures,
    ).toEqual([]);
    expect(
      compareReplayExpectation(expected, {
        output: {
          answer: "changed",
          redacted: "[REDACTED]",
          debug: { rawSecret: "sk-secret" },
        },
      }).failures,
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Expected output path "debug.rawSecret" to be absent'),
        expect.stringContaining('Expected output path "answer" to equal "ok", got "changed"'),
      ]),
    );
  });

  it("supports dotted output assertions through array indexes", () => {
    const expected = createReplayExpectation(
      { output: { items: [{ id: "one", status: "ok" }] } },
      {
        outputKeysMode: "subset",
        outputValues: { "items.0.id": "one" },
        absentOutputKeys: ["items.0.secret"],
      },
    );

    expect(
      compareReplayExpectation(expected, {
        output: { items: [{ id: "one", status: "ok" }] },
      }).failures,
    ).toEqual([]);
    expect(
      compareReplayExpectation(expected, {
        output: { items: [{ id: "two", secret: "raw" }] },
      }).failures,
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Expected output path "items.0.secret" to be absent'),
        expect.stringContaining('Expected output path "items.0.id" to equal "one", got "two"'),
      ]),
    );
  });

  it("supports runtime-gate tool-boundary trace event count mode", () => {
    const started = toolEvent;
    const succeeded = {
      ...toolEvent,
      sequence: 2,
      type: "tool.succeeded",
      record: {
        ...toolEvent.record,
        id: "tool-2",
        status: "succeeded",
      },
    };
    const events = parseTraceJsonl(`${JSON.stringify(started)}\n${JSON.stringify(succeeded)}\n`);
    const expected = createReplayExpectation({ events }, { traceEventCountMode: "tool-boundary" });

    expect(expected).toMatchObject({
      toolSequence: ["sendEmail"],
      toolStatuses: { sendEmail: ["started", "succeeded"] },
      traceEventCount: 2,
      traceEventCountMode: "tool-boundary",
    });
    expect(compareReplayExpectation(expected, { events }).failures).toEqual([]);
  });

  it("reports runtime-gate boundary replay drift clearly", () => {
    const expectedEvents = parseTraceJsonl(`${JSON.stringify(toolEvent)}\n`);
    const actualEvent = {
      ...toolEvent,
      record: {
        ...toolEvent.record,
        toolName: "lookupOrder",
        status: "blocked",
        policyVerdict: {
          status: "block",
          reasons: ["blocked"],
          riskTier: "high",
          toolName: "lookupOrder",
        },
      },
    };
    const actualStartedEvent = {
      ...toolEvent,
      sequence: 2,
      record: {
        ...toolEvent.record,
        id: "tool-2",
        toolName: "lookupOrder",
      },
    };
    const actualEvents = parseTraceJsonl(
      `${JSON.stringify(actualEvent)}\n${JSON.stringify(actualStartedEvent)}\n`,
    );
    const expected = createReplayExpectation(
      { events: expectedEvents },
      { traceEventCountMode: "tool-boundary" },
    );

    expect(compareReplayExpectation(expected, { events: actualEvents }).failures).toEqual(
      expect.arrayContaining([
        "Expected tool sequence [sendEmail], got [lookupOrder, lookupOrder].",
        'Expected tool statuses for "lookupOrder" [], got [blocked, started].',
        'Expected policy verdicts for "lookupOrder" [], got [block, review].',
        "Expected 1 tool-boundary trace events from fixture, got 2 current tool-boundary trace events. Trace event count mode: tool-boundary.",
      ]),
    );
  });

  it("rejects inconsistent replay fixture trace counts", () => {
    expect(() =>
      defineReplayFixture({
        version: "1",
        id: "bad-count",
        case: {
          id: "bad-count",
          prompt: "Bad count",
          expect: {},
        },
        captured: {
          traceEventCount: 2,
        },
        expect: {
          traceEventCount: 1,
        },
      }),
    ).toThrow("trace event counts");
  });

  it("collects output keys without recursing through cycles", () => {
    const output: Record<string, unknown> = { ok: true };
    output.self = output;

    expect(createReplayExpectation({ output }).outputKeys).toEqual(["ok", "self"]);
  });
});

async function* chunks(...values: string[]): AsyncGenerator<string> {
  for (const value of values) {
    yield value;
  }
}
