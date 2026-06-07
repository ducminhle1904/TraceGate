import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  compareReplayExpectation,
  createReplayExpectation,
  defineMatrix,
  defineReplayFixture,
  defineToolContract,
  EvidenceRecordSchema,
  evaluatePolicy,
  MatrixCaseSchema,
  parseTraceJsonl,
  parseTraceJsonlStream,
  redactValue,
  ToolCallRecordSchema,
  TraceGateRunSchema,
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
    });
  });

  it("returns block when approval is denied", () => {
    expect(evaluatePolicy({ contract: highRiskContract, approval: "denied" })).toMatchObject({
      status: "block",
      toolName: "issueRefund",
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
        "Expected output keys [blocked], got [].",
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
