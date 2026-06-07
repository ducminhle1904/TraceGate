import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  defineMatrix,
  defineToolContract,
  EvidenceRecordSchema,
  evaluatePolicy,
  MatrixCaseSchema,
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
