import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  comparePolicyVerdicts,
  createEvidenceRecord,
  createHarness,
  createJsonlFileTraceSink,
  createMemoryTraceSink,
  createPolicyEvaluator,
  createRuntimeGate,
  createStructuredLoggerTraceSink,
  definePolicy,
  defineToolContract,
  type RuntimeGateSummary,
  summarizeSideEffectSafety,
  type TraceEvent,
  TraceGateInputValidationError,
  TraceGatePolicyBlockedError,
  TraceGateReviewRequiredError,
  TraceGateToolExecutionError,
} from "../src/index.js";

const LookupInputSchema = z.object({
  orderId: z.string().min(1),
});

describe("runtime gate helper", () => {
  it("keeps mode off behavior unchanged", async () => {
    const traceSink = createMemoryTraceSink();
    let summaries = 0;
    const gate = createRuntimeGate({
      mode: "off",
      traceSink,
      onSummary: () => {
        summaries += 1;
      },
    });
    const lookup = gate.wrapTool(lookupOrderContract, async (input) => ({ id: input.orderId }));

    await expect(lookup({ orderId: "" })).resolves.toEqual({ id: "" });
    expect(traceSink.events).toEqual([]);
    expect(summaries).toBe(0);
  });

  it("keeps client preflight disabled when mode is off", async () => {
    const traceSink = createMemoryTraceSink();
    let summaries = 0;
    const gate = createRuntimeGate({
      mode: "off",
      traceSink,
      onSummary: () => {
        summaries += 1;
      },
    });

    const preflight = await gate.preflightToolCall(lookupOrderContract, { orderId: "" });
    const reconciled = await gate.reconcileToolCall(preflight, {
      output: { id: "" },
      sideEffectAlreadyOccurred: true,
    });

    expect(preflight).toMatchObject({
      decision: "allow",
      inputValid: true,
      enforceablePreCall: false,
    });
    expect(reconciled).toMatchObject({
      status: "executed",
      handlerExecuted: true,
      toolExecuted: true,
      traceEventCount: 0,
    });
    expect(traceSink.events).toEqual([]);
    expect(summaries).toBe(0);
  });

  it("observes invalid input without blocking host execution", async () => {
    const summaries: unknown[] = [];
    const gate = createRuntimeGate({
      mode: "observe",
      onSummary: (summary) => {
        summaries.push(summary);
      },
    });
    let executed = false;
    const lookup = gate.wrapTool(lookupOrderContract, async () => {
      executed = true;
      return { ok: true };
    });

    await expect(lookup({ orderId: "" })).resolves.toEqual({ ok: true });
    expect(executed).toBe(true);
    expect(summaries).toMatchObject([
      {
        validationFailed: true,
        handlerExecuted: true,
        toolExecuted: true,
        enforcementApplied: false,
        validationOnly: false,
      },
    ]);
  });

  it("includes stable host logging fields for observed execution summaries", async () => {
    const summaries: RuntimeGateSummary[] = [];
    const gate = createRuntimeGate({
      mode: "observe",
      onSummary: (summary) => {
        summaries.push(summary);
      },
    });
    const lookup = gate.wrapTool(lookupOrderContract, async (input) => ({ id: input.orderId }));

    await expect(lookup({ orderId: "order-1" })).resolves.toEqual({ id: "order-1" });

    expect(summaries[0]).toMatchObject({
      mode: "observe",
      toolName: "lookupOrder",
      riskTier: "read",
      status: "executed",
      handlerExecuted: true,
      toolExecuted: true,
      enforcementApplied: false,
      validationOnly: false,
      validationFailed: false,
    });
  });

  it("keeps runtime gate traces tool-boundary only by default", async () => {
    const traceSink = createMemoryTraceSink();
    const gate = createRuntimeGate({ mode: "observe", traceSink });
    const lookup = gate.wrapTool(lookupOrderContract, async (input) => ({ id: input.orderId }));

    await expect(lookup({ orderId: "order-1" })).resolves.toEqual({ id: "order-1" });

    expect(traceSink.events.map((event) => event.type)).toEqual(["tool.started", "tool.succeeded"]);
  });

  it("can emit harness-like run events around successful runtime gate calls", async () => {
    const traceSink = createMemoryTraceSink();
    const summaries: RuntimeGateSummary[] = [];
    const contract = defineToolContract({
      name: "lookupOrder",
      riskTier: "read",
      inputSchema: LookupInputSchema,
      metadata: {
        repoRiskTier: "read",
        apiKey: "sk-proj-1234567890abcdef1234567890abcdef",
      },
    });
    const gate = createRuntimeGate({
      mode: "observe",
      traceRunEvents: true,
      traceSink,
      context: {
        sessionId: "session-1",
        metadata: {
          toolCallId: "host-call-1",
          token: "Bearer abcdefghijklmnop",
        },
      },
      onSummary: (summary) => {
        summaries.push(summary);
      },
    });
    const lookup = gate.wrapTool(contract, async (input) => ({ id: input.orderId }));

    await expect(lookup({ orderId: "order-1" })).resolves.toEqual({ id: "order-1" });

    expect(traceSink.events.map((event) => event.type)).toEqual([
      "run.started",
      "tool.started",
      "tool.succeeded",
      "run.finished",
    ]);
    expect(traceSink.events.at(-1)).toMatchObject({
      type: "run.finished",
      run: {
        toolCalls: [
          { status: "started", toolName: "lookupOrder" },
          { status: "succeeded", toolName: "lookupOrder" },
        ],
      },
    });
    expect(summaries[0]).toMatchObject({
      traceEventTypes: ["run.started", "tool.started", "tool.succeeded", "run.finished"],
      traceEventCount: 4,
      context: {
        metadata: {
          toolCallId: "host-call-1",
          token: "[REDACTED]",
        },
      },
      contractMetadata: {
        repoRiskTier: "read",
        apiKey: "[REDACTED]",
      },
    });
    expect(summaries[0]?.runId).toEqual(expect.stringMatching(/^run_/));
    expect(summaries[0]?.toolCallId).toEqual(expect.stringMatching(/^tool_/));
  });

  it("bypasses validation and tracing for tools outside the allowlist", async () => {
    const traceSink = createMemoryTraceSink();
    const summaries: unknown[] = [];
    const gate = createRuntimeGate({
      mode: "enforce",
      allowlist: ["otherTool"],
      traceSink,
      onSummary: (summary) => {
        summaries.push(summary);
      },
    });
    const lookup = gate.wrapTool(lookupOrderContract, async (input) => ({ id: input.orderId }));

    await expect(lookup({ orderId: "" })).resolves.toEqual({ id: "" });
    expect(traceSink.events).toEqual([]);
    expect(summaries).toMatchObject([
      {
        status: "skipped",
        handlerExecuted: true,
        toolExecuted: true,
        enforcementApplied: false,
        validationOnly: false,
        traceEventCount: 0,
      },
    ]);
  });

  it("bypasses client preflight validation and tracing for tools outside the allowlist", async () => {
    const traceSink = createMemoryTraceSink();
    const summaries: RuntimeGateSummary[] = [];
    const gate = createRuntimeGate({
      mode: "enforce",
      allowlist: ["otherTool"],
      traceSink,
      onSummary: (summary) => {
        summaries.push(summary);
      },
    });

    const preflight = await gate.preflightToolCall(lookupOrderContract, { orderId: "" });
    const reconciled = await gate.reconcileToolCall(preflight, {
      sideEffectAlreadyOccurred: true,
    });

    expect(preflight).toMatchObject({
      decision: "allow",
      inputValid: true,
      enforceablePreCall: false,
    });
    expect(reconciled).toMatchObject({
      status: "executed",
      handlerExecuted: true,
      toolExecuted: true,
      traceEventCount: 0,
    });
    expect(traceSink.events).toEqual([]);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      status: "executed",
      enforcementApplied: false,
      traceEventCount: 0,
    });
  });

  it("enforces validation before host execution and can adapt errors", async () => {
    const gate = createRuntimeGate({
      mode: "enforce",
      enforcement: { validationOnly: true, riskTiers: ["read"] },
      errorAdapter: (error, context) => ({
        type: "tool_result",
        ok: false,
        blocked: true,
        errorName: error instanceof Error ? error.name : "unknown",
        tool: context.contract.name,
        riskTier: context.summary.riskTier,
        finalVerdict: context.summary.finalVerdict?.status,
        diagnostics: context.summary.diagnostics.map((diagnostic) => diagnostic.rule),
        executed: context.summary.handlerExecuted,
        toolExecuted: context.summary.toolExecuted,
        handlerSkippedReason: context.summary.handlerSkippedReason,
        sideEffectPrevented: context.summary.sideEffectPrevented,
        enforcementApplied: context.summary.enforcementApplied,
        validationOnly: context.summary.validationOnly,
      }),
    });
    let executed = false;
    const lookup = gate.wrapTool(lookupOrderContract, async () => {
      executed = true;
      return { ok: true };
    });

    await expect(lookup({ orderId: "" })).resolves.toEqual({
      type: "tool_result",
      ok: false,
      blocked: true,
      errorName: "TraceGateInputValidationError",
      tool: "lookupOrder",
      riskTier: "read",
      executed: false,
      toolExecuted: false,
      handlerSkippedReason: "validation-failed",
      sideEffectPrevented: true,
      enforcementApplied: true,
      validationOnly: true,
      diagnostics: [],
    });
    expect(executed).toBe(false);
  });

  it("scopes enforcement by tool name", async () => {
    const gate = createRuntimeGate({
      mode: "enforce",
      enforcement: { toolNames: ["lookupOrder"] },
    });
    const lookup = gate.wrapTool(lookupOrderContract, async () => ({ ok: "lookup" }));
    const other = gate.wrapTool(otherLookupContract, async () => ({ ok: "other" }));

    await expect(lookup({ orderId: "" })).rejects.toBeInstanceOf(TraceGateInputValidationError);
    await expect(other({ orderId: "" })).resolves.toEqual({ ok: "other" });
  });

  it("combines enforcement tool names and risk tiers", async () => {
    const gate = createRuntimeGate({
      mode: "enforce",
      enforcement: { toolNames: ["lookupOrder"], riskTiers: ["high"] },
    });
    const lookup = gate.wrapTool(lookupOrderContract, async () => ({ ok: "read-risk" }));
    const refund = gate.wrapTool(refundContract, async () => ({ ok: "high-risk" }));

    await expect(lookup({ orderId: "" })).resolves.toEqual({ ok: "read-risk" });
    await expect(refund({ orderId: "", amount: -1 })).resolves.toEqual({ ok: "high-risk" });
  });

  it("validation-only enforcement does not block policy review verdicts", async () => {
    const summaries: RuntimeGateSummary[] = [];
    const gate = createRuntimeGate({
      mode: "enforce",
      enforcement: { validationOnly: true, riskTiers: ["high"] },
      onSummary: (summary) => {
        summaries.push(summary);
      },
    });
    let executed = false;
    const refund = gate.wrapTool(refundContract, async () => {
      executed = true;
      return { ok: true };
    });

    await expect(refund({ orderId: "order-1", amount: 10 })).resolves.toEqual({ ok: true });
    expect(executed).toBe(true);
    expect(summaries[0]).toMatchObject({
      status: "executed",
      toolExecuted: true,
      sideEffectPrevented: false,
      enforcementApplied: true,
      validationOnly: true,
      finalVerdict: {
        status: "review",
      },
    });
  });

  it("adapts blocked tool errors into host SSE envelopes with stable summary fields", async () => {
    const gate = createRuntimeGate({
      mode: "enforce",
      enforcement: { toolNames: ["lookupOrder"] },
      context: {
        sessionId: "session-1",
        metadata: {
          toolCallId: "host-call-1",
          episodeId: "episode-1",
        },
      },
      errorAdapter: (error, context) => ({
        event: "tracegate.tool.blocked",
        data: {
          ok: false,
          blocked: true,
          toolName: context.summary.toolName,
          riskTier: context.summary.riskTier,
          finalVerdict: context.summary.finalVerdict?.status,
          diagnostics: context.summary.diagnostics.map((diagnostic) => diagnostic.rule),
          message: error instanceof Error ? error.message : String(error),
          hostToolCallId: context.summary.context?.metadata?.toolCallId,
          toolExecuted: context.summary.toolExecuted,
          handlerSkippedReason: context.summary.handlerSkippedReason,
          sideEffectPrevented: context.summary.sideEffectPrevented,
          enforcementApplied: context.summary.enforcementApplied,
          validationOnly: context.summary.validationOnly,
        },
      }),
    });
    let executed = false;
    const lookup = gate.wrapTool(lookupOrderContract, async () => {
      executed = true;
      return { ok: true };
    });

    await expect(lookup({ orderId: "" })).resolves.toEqual({
      event: "tracegate.tool.blocked",
      data: {
        ok: false,
        blocked: true,
        toolName: "lookupOrder",
        riskTier: "read",
        message: "Tool input failed contract validation.",
        hostToolCallId: "host-call-1",
        toolExecuted: false,
        handlerSkippedReason: "validation-failed",
        sideEffectPrevented: true,
        enforcementApplied: true,
        validationOnly: false,
        diagnostics: [],
      },
    });
    expect(executed).toBe(false);
  });

  it("can emit harness-like run events around blocked runtime gate calls", async () => {
    const traceSink = createMemoryTraceSink();
    const summaries: RuntimeGateSummary[] = [];
    const gate = createRuntimeGate({
      mode: "enforce",
      traceRunEvents: true,
      traceSink,
      onSummary: (summary) => {
        summaries.push(summary);
      },
    });
    const lookup = gate.wrapTool(lookupOrderContract, async () => ({ ok: true }));

    await expect(lookup({ orderId: "" })).rejects.toBeInstanceOf(TraceGateInputValidationError);

    expect(traceSink.events.map((event) => event.type)).toEqual([
      "run.started",
      "tool.blocked",
      "run.finished",
    ]);
    expect(summaries[0]).toMatchObject({
      traceEventTypes: ["run.started", "tool.blocked", "run.finished"],
      toolCallId: expect.stringMatching(/^tool_/),
      toolExecuted: false,
      handlerSkippedReason: "validation-failed",
      sideEffectPrevented: true,
      enforcementApplied: true,
      validationOnly: false,
    });
  });

  it("blocks denied approval with the same diagnostics as the harness path", async () => {
    const summaries: RuntimeGateSummary[] = [];
    const gate = createRuntimeGate({
      mode: "enforce",
      approvalHandler: () => ({ status: "denied", reason: "Manager rejected the refund." }),
      onSummary: (summary) => {
        summaries.push(summary);
      },
    });
    let executed = false;
    const refund = gate.wrapTool(refundContract, async () => {
      executed = true;
      return { ok: true };
    });

    await expect(refund({ orderId: "order-1", amount: 10 })).rejects.toMatchObject({
      verdict: {
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            source: "approval-handler",
            rule: "approval-denied",
            message: "Manager rejected the refund.",
          }),
          expect.objectContaining({
            source: "runtime",
            rule: "execution-skipped",
          }),
        ]),
      },
    });
    expect(executed).toBe(false);
    expect(summaries[0]).toMatchObject({
      handlerExecuted: false,
      handlerSkippedReason: "approval-denied",
      sideEffectPrevented: true,
    });
  });

  it("summarizes failed host tool execution with stable logging fields", async () => {
    const summaries: RuntimeGateSummary[] = [];
    const gate = createRuntimeGate({
      mode: "observe",
      onSummary: (summary) => {
        summaries.push(summary);
      },
    });
    const lookup = gate.wrapTool(lookupOrderContract, async () => {
      throw new Error("host tool failed");
    });

    await expect(lookup({ orderId: "order-1" })).rejects.toBeInstanceOf(
      TraceGateToolExecutionError,
    );
    expect(summaries[0]).toMatchObject({
      status: "failed",
      handlerExecuted: true,
      toolExecuted: true,
      enforcementApplied: false,
      validationOnly: false,
      validationFailed: false,
    });
  });

  it("records side-effect prevention for policy block and review-required paths", async () => {
    const blockedSummaries: RuntimeGateSummary[] = [];
    const blockedGate = createRuntimeGate({
      mode: "enforce",
      policyEvaluator: ({ contract }) => ({
        status: "block",
        reasons: ["Blocked by test policy."],
        riskTier: contract.riskTier,
        toolName: contract.name,
      }),
      onSummary: (summary) => {
        blockedSummaries.push(summary);
      },
    });
    const blockedLookup = blockedGate.wrapTool(lookupOrderContract, async () => ({ ok: true }));

    await expect(blockedLookup({ orderId: "order-1" })).rejects.toBeInstanceOf(
      TraceGatePolicyBlockedError,
    );
    expect(blockedSummaries[0]).toMatchObject({
      handlerExecuted: false,
      handlerSkippedReason: "policy-blocked",
      sideEffectPrevented: true,
    });

    const reviewSummaries: RuntimeGateSummary[] = [];
    const reviewGate = createRuntimeGate({
      mode: "enforce",
      onSummary: (summary) => {
        reviewSummaries.push(summary);
      },
    });
    const reviewRefund = reviewGate.wrapTool(refundContract, async () => ({ ok: true }));

    await expect(reviewRefund({ orderId: "order-1", amount: 10 })).rejects.toBeInstanceOf(
      TraceGateReviewRequiredError,
    );
    expect(reviewSummaries[0]).toMatchObject({
      handlerExecuted: false,
      handlerSkippedReason: "review-required",
      sideEffectPrevented: true,
    });
  });

  it("summarizes shadow policy mismatches without blocking", async () => {
    const summaries: RuntimeGateSummary[] = [];
    const gate = createRuntimeGate({
      mode: "shadow",
      policyEvaluator: ({ contract }) => ({
        status: "block",
        reasons: ["TraceGate blocks this tool."],
        riskTier: contract.riskTier,
        toolName: contract.name,
      }),
      runtimeVerdictEvaluator: ({ contract }) => ({
        status: "allow",
        reasons: ["Runtime currently allows this tool."],
        riskTier: contract.riskTier,
        toolName: contract.name,
      }),
      onSummary: (summary) => {
        summaries.push(summary);
      },
    });
    const lookup = gate.wrapTool(lookupOrderContract, async () => ({ ok: true }));

    await expect(lookup({ orderId: "order-1" })).resolves.toEqual({ ok: true });
    expect(summaries[0]?.shadowComparison?.classifications).toContain(
      "runtime_allow_tracegate_block",
    );
    expect(summaries[0]).toMatchObject({
      handlerExecuted: true,
      sideEffectPrevented: false,
      wouldHaveExecutedInShadow: false,
    });
  });

  it("starts runtime verdict evaluation before shadow policy resolution completes", async () => {
    let releasePolicy!: () => void;
    let runtimeVerdictStarted = false;
    const gate = createRuntimeGate({
      mode: "shadow",
      policyEvaluator: async ({ contract }) => {
        await new Promise<void>((resolve) => {
          releasePolicy = resolve;
        });
        return {
          status: "allow",
          reasons: ["TraceGate allows this tool."],
          riskTier: contract.riskTier,
          toolName: contract.name,
        };
      },
      runtimeVerdictEvaluator: ({ contract }) => {
        runtimeVerdictStarted = true;
        return {
          status: "allow",
          reasons: ["Runtime allows this tool."],
          riskTier: contract.riskTier,
          toolName: contract.name,
        };
      },
    });
    const lookup = gate.wrapTool(lookupOrderContract, async () => ({ ok: true }));

    const result = lookup({ orderId: "order-1" });
    await delay(0);
    expect(runtimeVerdictStarted).toBe(true);
    releasePolicy();

    await expect(result).resolves.toEqual({ ok: true });
  });

  it("surfaces runtime verdict evaluator rejection in shadow mode", async () => {
    const gate = createRuntimeGate({
      mode: "shadow",
      policyEvaluator: ({ contract }) => ({
        status: "allow",
        reasons: ["TraceGate allows this tool."],
        riskTier: contract.riskTier,
        toolName: contract.name,
      }),
      runtimeVerdictEvaluator: () => {
        throw new Error("runtime verdict failed");
      },
    });
    const lookup = gate.wrapTool(lookupOrderContract, async () => ({ ok: true }));

    await expect(lookup({ orderId: "order-1" })).rejects.toThrow("runtime verdict failed");
  });

  it("redacts logger sink output before production-style logging", async () => {
    const logged: string[] = [];
    const traceSink = createStructuredLoggerTraceSink({
      log(event) {
        logged.push(JSON.stringify(event));
      },
    });
    const secretContract = defineToolContract({
      name: "lookupSecret",
      riskTier: "read",
      inputSchema: z.object({ apiKey: z.string(), orderId: z.string() }),
    });
    const gate = createRuntimeGate({ mode: "observe", traceSink });
    const lookup = gate.wrapTool(secretContract, async () => ({
      token: "Bearer abcdefghijklmnop",
    }));

    await lookup({ apiKey: "sk-proj-1234567890abcdef1234567890abcdef", orderId: "order-1" });

    const output = logged.join("\n");
    expect(output).not.toContain("sk-proj-1234567890abcdef1234567890abcdef");
    expect(output).not.toContain("Bearer abcdefghijklmnop");
    expect(output).toContain("[REDACTED]");
  });

  it("serializes async trace sink writes across concurrent calls", async () => {
    const events: TraceEvent[] = [];
    const traceSink = createStructuredLoggerTraceSink({
      async log(event) {
        if (event.sequence === 1) {
          await delay(20);
        }
        events.push(event);
      },
    });
    const gate = createRuntimeGate({ mode: "observe", traceSink });
    const lookup = gate.wrapTool(lookupOrderContract, async (input) => ({ id: input.orderId }));

    await Promise.all([lookup({ orderId: "order-1" }), lookup({ orderId: "order-2" })]);

    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3, 4]);
  });

  it("classifies policy comparison results", () => {
    expect(
      comparePolicyVerdicts({
        contract: lookupOrderContract,
        runtimeVerdict: {
          status: "allow",
          reasons: ["runtime allow"],
          riskTier: "read",
          toolName: "lookupOrder",
        },
        traceGateVerdict: {
          status: "review",
          reasons: ["tracegate review"],
          riskTier: "read",
          toolName: "lookupOrder",
        },
      }).classifications,
    ).toEqual(["runtime_allow_tracegate_review"]);
  });

  it("summarizes side-effect safety from runtime summaries and tool records", () => {
    const summary = summarizeSideEffectSafety({
      mode: "enforce",
      toolName: "issueRefund",
      riskTier: "high",
      status: "blocked",
      handlerExecuted: false,
      toolExecuted: false,
      handlerSkippedReason: "approval-denied",
      sideEffectPrevented: true,
      validationFailed: false,
      finalVerdict: {
        status: "block",
        reasons: ["Approval denied."],
        riskTier: "high",
        toolName: "issueRefund",
        diagnostics: [
          {
            source: "approval-handler",
            rule: "approval-denied",
            message: "Denied.",
          },
        ],
      },
      diagnostics: [
        {
          source: "approval-handler",
          rule: "approval-denied",
          message: "Denied.",
        },
      ],
      traceEventTypes: ["tool.blocked"],
      traceEventCount: 1,
      secretLeakFindingCount: 0,
    });

    expect(summary).toEqual({
      handlerExecuted: false,
      handlerSkippedReason: "approval-denied",
      sideEffectPrevented: true,
      toolName: "issueRefund",
      riskTier: "high",
      finalVerdict: "block",
      diagnosticRules: ["approval-handler:approval-denied"],
    });

    expect(
      summarizeSideEffectSafety({
        id: "tool-1",
        runId: "run-1",
        toolName: "issueRefund",
        timestamp: "2026-06-07T00:00:00.000Z",
        status: "blocked",
        riskTier: "high",
        policyVerdict: {
          status: "review",
          reasons: ["Approval required."],
          riskTier: "high",
          toolName: "issueRefund",
        },
      }),
    ).toMatchObject({
      handlerExecuted: false,
      handlerSkippedReason: "review-required",
      sideEffectPrevented: true,
      finalVerdict: "review",
    });

    expect(summarizeSideEffectSafety({})).toEqual({
      handlerExecuted: false,
      sideEffectPrevented: false,
      diagnosticRules: [],
    });
  });
});

const lookupOrderContract = defineToolContract({
  name: "lookupOrder",
  riskTier: "read",
  inputSchema: LookupInputSchema,
});

const otherLookupContract = defineToolContract({
  name: "otherLookup",
  riskTier: "read",
  inputSchema: LookupInputSchema,
});

const refundContract = defineToolContract({
  name: "issueRefund",
  riskTier: "high",
  requiresApproval: true,
  inputSchema: z.object({
    orderId: z.string().min(1),
    amount: z.number().positive(),
  }),
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("createHarness runtime", () => {
  it("executes an allowed low-risk call and emits ordered trace events", async () => {
    const traceSink = createMemoryTraceSink();
    const harness = createHarness({ surface: "support-dashboard", traceSink });
    const lookupOrder = harness.wrapTool(lookupOrderContract, async (input) => ({
      id: input.orderId,
      status: "paid",
    }));

    await harness.startRun({ id: "run-allowed" });
    await expect(lookupOrder({ orderId: "order-1" })).resolves.toEqual({
      id: "order-1",
      status: "paid",
    });
    await harness.finishRun();

    expect(traceSink.events.map((event) => event.type)).toEqual([
      "run.started",
      "tool.started",
      "tool.succeeded",
      "run.finished",
    ]);
    expect(traceSink.events.map((event) => event.sequence)).toEqual([1, 2, 3, 4]);
  });

  it("rejects invalid input before execution", async () => {
    const traceSink = createMemoryTraceSink();
    const harness = createHarness({ traceSink });
    let executed = false;
    const lookupOrder = harness.wrapTool(lookupOrderContract, () => {
      executed = true;
    });

    await expect(lookupOrder({ orderId: "" })).rejects.toBeInstanceOf(
      TraceGateInputValidationError,
    );

    expect(executed).toBe(false);
    expect(traceSink.events.map((event) => event.type)).toEqual(["run.started", "tool.blocked"]);
  });

  it("does not execute when policy blocks a call", async () => {
    const traceSink = createMemoryTraceSink();
    const harness = createHarness({
      traceSink,
      policyEvaluator: ({ contract }) => ({
        status: "block",
        reasons: ["Blocked by test policy."],
        riskTier: contract.riskTier,
        toolName: contract.name,
      }),
    });
    let executed = false;
    const refund = harness.wrapTool(refundContract, () => {
      executed = true;
    });

    await expect(refund({ orderId: "order-1", amount: 10 })).rejects.toBeInstanceOf(
      TraceGatePolicyBlockedError,
    );

    expect(executed).toBe(false);
    expect(traceSink.events.at(-1)).toMatchObject({ type: "tool.blocked" });
  });

  it("does not execute review verdicts without an approval handler", async () => {
    const harness = createHarness();
    let executed = false;
    const refund = harness.wrapTool(refundContract, () => {
      executed = true;
    });

    await expect(refund({ orderId: "order-1", amount: 10 })).rejects.toBeInstanceOf(
      TraceGateReviewRequiredError,
    );

    expect(executed).toBe(false);
  });

  it("executes review verdicts when the approval handler approves", async () => {
    const traceSink = createMemoryTraceSink();
    const harness = createHarness({
      traceSink,
      approvalHandler: () => "approved",
    });
    const refund = harness.wrapTool(refundContract, async (input) => ({
      refunded: input.amount,
    }));

    await expect(refund({ orderId: "order-1", amount: 10 })).resolves.toEqual({ refunded: 10 });

    expect(traceSink.events.map((event) => event.type)).toEqual([
      "run.started",
      "tool.started",
      "tool.succeeded",
    ]);
  });

  it("does not execute when approval is denied", async () => {
    const harness = createHarness({
      approvalHandler: () => ({ status: "denied", reason: "Manager rejected the refund." }),
    });
    let executed = false;
    const refund = harness.wrapTool(refundContract, () => {
      executed = true;
    });

    let thrown: unknown;
    try {
      await refund({ orderId: "order-1", amount: 10 });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(TraceGatePolicyBlockedError);
    expect(thrown).toMatchObject({
      verdict: {
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            source: "approval-handler",
            rule: "approval-denied",
            message: "Manager rejected the refund.",
          }),
          expect.objectContaining({
            source: "runtime",
            rule: "execution-skipped",
          }),
        ]),
      },
    });
    expect(executed).toBe(false);
  });

  it("blocks configured risk tiers before execution", async () => {
    const traceSink = createMemoryTraceSink();
    const harness = createHarness({
      traceSink,
      policyEvaluator: createPolicyEvaluator(definePolicy({ blockRiskTiers: ["high"] })),
    });
    let executed = false;
    const refund = harness.wrapTool(refundContract, () => {
      executed = true;
    });

    await expect(refund({ orderId: "order-1", amount: 10 })).rejects.toBeInstanceOf(
      TraceGatePolicyBlockedError,
    );

    expect(executed).toBe(false);
    expect(traceSink.events.at(-1)).toMatchObject({
      type: "tool.blocked",
      record: {
        policyVerdict: {
          status: "block",
        },
      },
    });
  });

  it("requires approval by risk tier even when a high-risk alias omits contract approval", async () => {
    const traceSink = createMemoryTraceSink();
    const highRiskAlias = defineToolContract({
      name: "emailAlias",
      riskTier: "high",
      inputSchema: z.object({ body: z.string() }),
    });
    const harness = createHarness({
      traceSink,
      policyEvaluator: createPolicyEvaluator(
        definePolicy({ requireApprovalForRiskTiers: ["high"] }),
      ),
    });
    let executed = false;
    const alias = harness.wrapTool(highRiskAlias, () => {
      executed = true;
    });

    await expect(alias({ body: "send refund email" })).rejects.toBeInstanceOf(
      TraceGateReviewRequiredError,
    );

    expect(executed).toBe(false);
  });

  it("requires configured evidence before an approved high-risk tool executes", async () => {
    const traceSink = createMemoryTraceSink();
    const harness = createHarness({
      traceSink,
      approvalHandler: () => "approved",
      policyEvaluator: createPolicyEvaluator(
        definePolicy({
          requireApprovalForRiskTiers: ["high"],
          requiredEvidence: {
            issueRefund: ["manager"],
          },
        }),
      ),
    });
    let executed = false;
    const refund = harness.wrapTool(refundContract, () => {
      executed = true;
    });

    await expect(refund({ orderId: "order-1", amount: 10 })).rejects.toBeInstanceOf(
      TraceGateReviewRequiredError,
    );
    expect(executed).toBe(false);

    await harness.recordEvidence({
      id: "approval-1",
      type: "user-approval",
      timestamp: "2026-06-07T00:00:00.000Z",
      content: { approvedBy: "manager" },
    });

    await expect(refund({ orderId: "order-1", amount: 10 })).resolves.toBeUndefined();
  });

  it("traces thrown tool errors and preserves the original cause", async () => {
    const traceSink = createMemoryTraceSink();
    const harness = createHarness({ traceSink });
    const original = new Error("CRM unavailable");
    const lookupOrder = harness.wrapTool(lookupOrderContract, () => {
      throw original;
    });

    let thrown: unknown;
    try {
      await lookupOrder({ orderId: "order-1" });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(TraceGateToolExecutionError);
    expect(thrown).toMatchObject({ cause: original });

    expect(traceSink.events.at(-1)).toMatchObject({
      type: "tool.failed",
      record: {
        error: "CRM unavailable",
      },
    });
  });

  it("records evidence on the active run and trace sink", async () => {
    const traceSink = createMemoryTraceSink();
    const harness = createHarness({ traceSink });
    await harness.startRun({ id: "run-evidence" });

    await harness.recordEvidence({
      id: "evidence-1",
      type: "user-approval",
      timestamp: "2026-06-07T00:00:00.000Z",
      content: { approvedBy: "manager" },
    });

    const evidenceEvent = traceSink.events.at(-1);
    expect(evidenceEvent).toMatchObject({
      type: "evidence.recorded",
      record: {
        id: "evidence-1",
      },
    });
  });

  it("auto-fills evidence timestamps when omitted", async () => {
    const traceSink = createMemoryTraceSink();
    const harness = createHarness({ traceSink });
    await harness.startRun({ id: "run-evidence-auto-timestamp" });

    const evidence = await harness.recordEvidence({
      id: "evidence-auto-timestamp",
      type: "system",
      content: { ok: true },
    });

    expect(evidence.timestamp).toEqual(expect.any(String));
    expect(() => new Date(evidence.timestamp).toISOString()).not.toThrow();
    expect(traceSink.events.at(-1)).toMatchObject({
      type: "evidence.recorded",
      timestamp: evidence.timestamp,
      record: {
        id: "evidence-auto-timestamp",
        timestamp: evidence.timestamp,
      },
    });
  });

  it("starts a new run after finishing the previous run", async () => {
    const traceSink = createMemoryTraceSink();
    const harness = createHarness({ traceSink });
    const lookupOrder = harness.wrapTool(lookupOrderContract, async (input) => input.orderId);

    await harness.startRun({ id: "run-one" });
    await lookupOrder({ orderId: "order-1" });
    await harness.finishRun();
    await lookupOrder({ orderId: "order-2" });

    expect(traceSink.events.map((event) => event.type)).toEqual([
      "run.started",
      "tool.started",
      "tool.succeeded",
      "run.finished",
      "run.started",
      "tool.started",
      "tool.succeeded",
    ]);
    expect(traceSink.events.at(5)).toMatchObject({
      type: "tool.started",
      runId: expect.not.stringMatching(/^run-one$/),
    });
  });

  it("keeps tool evidence bound to the tool run", async () => {
    const traceSink = createMemoryTraceSink();
    const harness = createHarness({ traceSink });
    let evidenceRunId = "";
    const lookupOrder = harness.wrapTool(lookupOrderContract, async (_input, context) => {
      await harness.startRun({ id: "run-two" });
      await context.recordEvidence({
        id: "evidence-bound",
        type: "system",
        timestamp: "2026-06-07T00:00:00.000Z",
        content: { ok: true },
      });
      evidenceRunId = context.runId;
      return "ok";
    });

    await harness.startRun({ id: "run-one" });
    await lookupOrder({ orderId: "order-1" });

    const evidenceEvent = traceSink.events.find((event) => event.type === "evidence.recorded");
    expect(evidenceEvent).toMatchObject({
      runId: evidenceRunId,
      record: { id: "evidence-bound" },
    });
  });

  it("passes a snapshot of the run to tool callbacks", async () => {
    const traceSink = createMemoryTraceSink();
    const harness = createHarness({ traceSink });
    const lookupOrder = harness.wrapTool(lookupOrderContract, async (_input, context) => {
      context.run.toolCalls.push({
        id: "fake-tool-call",
        runId: context.runId,
        toolName: "fake",
        riskTier: "read",
        status: "succeeded",
        timestamp: "2026-06-07T00:00:00.000Z",
      });
      return "ok";
    });

    await lookupOrder({ orderId: "order-1" });
    await harness.finishRun();

    const finishedEvent = traceSink.events.find((event) => event.type === "run.finished");
    expect(finishedEvent).toMatchObject({
      run: {
        toolCalls: expect.not.arrayContaining([expect.objectContaining({ id: "fake-tool-call" })]),
      },
    });
  });

  it("serializes async trace sink writes in event order", async () => {
    const events: TraceEvent[] = [];
    const traceSink = {
      async write(event: TraceEvent) {
        if (event.sequence === 2) {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        events.push(event);
      },
    };
    const harness = createHarness({ traceSink });
    const lookupOrder = harness.wrapTool(lookupOrderContract, async () => "ok");

    await lookupOrder({ orderId: "order-1" });
    await harness.finishRun();

    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3, 4]);
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "tool.started",
      "tool.succeeded",
      "run.finished",
    ]);
  });

  it("does not wrap trace sink failures as tool execution errors", async () => {
    const sinkError = new Error("trace sink unavailable");
    let executed = false;
    const traceSink = {
      write(event: TraceEvent) {
        if (event.type === "tool.succeeded") {
          throw sinkError;
        }
      },
    };
    const harness = createHarness({ traceSink });
    const lookupOrder = harness.wrapTool(lookupOrderContract, async () => {
      executed = true;
      return "ok";
    });

    let thrown: unknown;
    try {
      await lookupOrder({ orderId: "order-1" });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBe(sinkError);
    expect(thrown).not.toBeInstanceOf(TraceGateToolExecutionError);
    expect(executed).toBe(true);
  });

  it("writes parseable JSONL trace events", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tracegate-"));
    const filePath = join(dir, "trace.jsonl");

    try {
      const harness = createHarness({ traceSink: createJsonlFileTraceSink(filePath) });
      const lookupOrder = harness.wrapTool(lookupOrderContract, async () => ({ status: "paid" }));

      await lookupOrder({ orderId: "order-1" });
      await harness.finishRun();

      const lines = (await readFile(filePath, "utf8")).trim().split("\n");
      expect(lines.map((line) => JSON.parse(line).type)).toEqual([
        "run.started",
        "tool.started",
        "tool.succeeded",
        "run.finished",
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("redacts trace input and output fields", async () => {
    const traceSink = createMemoryTraceSink();
    const contract = defineToolContract({
      name: "saveSecret",
      riskTier: "low",
      inputSchema: z.object({
        token: z.string(),
        visible: z.string(),
      }),
    });
    const harness = createHarness({ traceSink });
    const saveSecret = harness.wrapTool(contract, async () => ({
      apiKey: "secret-api-key",
      ok: true,
    }));

    await saveSecret({ token: "secret-token", visible: "safe" });

    expect(traceSink.events.at(1)).toMatchObject({
      record: {
        input: {
          token: "[REDACTED]",
          visible: "safe",
        },
      },
    });
    expect(traceSink.events.at(2)).toMatchObject({
      record: {
        output: {
          apiKey: "[REDACTED]",
          ok: true,
        },
      },
    });
  });

  it("redacts secret-like values in trace input and output fields", async () => {
    const traceSink = createMemoryTraceSink();
    const contract = defineToolContract({
      name: "sendToken",
      riskTier: "low",
      inputSchema: z.object({
        note: z.string(),
      }),
    });
    const harness = createHarness({ traceSink });
    const sendToken = harness.wrapTool(contract, async () => ({
      message: "Bearer abcdefghijklmnopqrstuvwxyz",
    }));

    await sendToken({ note: "Bearer abcdefghijklmnopqrstuvwxyz" });

    expect(traceSink.events.at(1)).toMatchObject({
      record: {
        input: {
          note: "[REDACTED]",
        },
      },
    });
    expect(traceSink.events.at(2)).toMatchObject({
      record: {
        output: {
          message: "[REDACTED]",
        },
      },
    });
  });

  it("preflights invalid client tool input before host execution", async () => {
    const traceSink = createMemoryTraceSink();
    const summaries: RuntimeGateSummary[] = [];
    const gate = createRuntimeGate({
      mode: "enforce",
      enforcement: { validationOnly: true, toolNames: ["lookupOrder"] },
      traceSink,
      onSummary: (summary) => {
        summaries.push(summary);
      },
    });

    const preflight = await gate.preflightToolCall(lookupOrderContract, { orderId: "" });

    expect(preflight).toMatchObject({
      decision: "block",
      inputValid: false,
      enforceablePreCall: true,
      sideEffectAlreadyOccurred: false,
      preventability: "prevented",
    });
    expect(traceSink.events.map((event) => event.type)).toEqual(["tool.pre_call"]);
    expect(summaries[0]).toMatchObject({
      handlerExecuted: false,
      toolExecuted: false,
      handlerSkippedReason: "validation-failed",
      sideEffectPrevented: true,
      enforceablePreCall: true,
      preventability: "prevented",
    });
    await expect(gate.reconcileToolCall(preflight.id)).rejects.toThrow(
      /No runtime gate preflight is active/,
    );
  });

  it("reconciles post-call evidence without pretending client side effects were prevented", async () => {
    const traceSink = createMemoryTraceSink();
    const summaries: RuntimeGateSummary[] = [];
    const contract = defineToolContract({
      name: "createInvoiceDraft",
      riskTier: "medium",
      inputSchema: z.object({ invoiceId: z.string().min(1) }),
      sideEffectClass: "persisted_write",
      requiredEvidence: ["invoice_snapshot"],
    });
    const gate = createRuntimeGate({
      mode: "observe",
      traceSink,
      policyEvaluator: createPolicyEvaluator({}),
      onSummary: (summary) => {
        summaries.push(summary);
      },
    });

    const preflight = await gate.preflightToolCall(contract, { invoiceId: "inv-1" });
    const evidence = createEvidenceRecord({
      id: "invoice_snapshot:inv-1",
      type: "tool-output",
      source: "host",
      content: { kind: "invoice_snapshot", invoiceId: "inv-1" },
    });
    const reconciled = await gate.reconcileToolCall(preflight, {
      output: { saved: true },
      evidence: [evidence],
      runtimeVerdict: "allow",
      sideEffectAlreadyOccurred: true,
    });

    expect(preflight).toMatchObject({
      decision: "review",
      evidenceSatisfied: false,
      preventability: "requires_post_call_evidence",
    });
    expect(reconciled).toMatchObject({
      preCallVerdict: { status: "review" },
      postCallVerdict: { status: "allow" },
      runtimeVerdict: "allow",
      evidenceSatisfied: true,
      sideEffectAlreadyOccurred: true,
      sideEffectPrevented: false,
      preventability: "not_preventable_at_pre_call",
    });
    expect(traceSink.events.map((event) => event.type)).toEqual([
      "tool.pre_call",
      "evidence.recorded",
      "tool.post_call",
      "tool.reconciled",
    ]);
    expect(summaries.at(-1)).toMatchObject({
      handlerExecuted: true,
      toolExecuted: true,
      sideEffectPrevented: false,
    });
  });

  it("does not infer client side-effect occurrence from output alone", async () => {
    const gate = createRuntimeGate({
      mode: "observe",
      policyEvaluator: createPolicyEvaluator({}),
    });

    const preflight = await gate.preflightToolCall(lookupOrderContract, { orderId: "ord-1" });
    const reconciled = await gate.reconcileToolCall(preflight, {
      output: { dryRun: true },
    });

    expect(reconciled).toMatchObject({
      status: "skipped",
      handlerExecuted: false,
      toolExecuted: false,
      sideEffectAlreadyOccurred: false,
      runtimeVerdict: "review",
    });
  });

  it("classifies portable shadow mismatches for evidence and approval gaps", () => {
    const evidenceReview = comparePolicyVerdicts({
      contract: lookupOrderContract,
      runtimeVerdict: {
        status: "allow",
        reasons: ["runtime allowed"],
        riskTier: "read",
        toolName: "lookupOrder",
      },
      traceGateVerdict: {
        status: "review",
        reasons: ["Missing required evidence"],
        riskTier: "read",
        toolName: "lookupOrder",
        diagnostics: [
          {
            source: "policy",
            rule: "missing-required-evidence",
            message: "Missing invoice_snapshot evidence.",
            riskTier: "read",
          },
        ],
      },
    });
    const approvalReview = comparePolicyVerdicts({
      contract: lookupOrderContract,
      runtimeVerdict: {
        status: "allow",
        reasons: ["runtime allowed"],
        riskTier: "read",
        toolName: "lookupOrder",
      },
      traceGateVerdict: {
        status: "review",
        reasons: ["Approval is missing"],
        riskTier: "read",
        toolName: "lookupOrder",
        diagnostics: [
          {
            source: "policy",
            rule: "risk-tier-requires-approval",
            message: "Approval required.",
            riskTier: "read",
            approval: "missing",
          },
        ],
      },
    });

    expect(evidenceReview.classifications).toEqual(
      expect.arrayContaining([
        "runtime_allow_tracegate_review",
        "runtime_allow_tracegate_requires_evidence",
      ]),
    );
    expect(evidenceReview.gapCategory).toBe("evidence_gap");
    expect(approvalReview.classifications).toEqual(
      expect.arrayContaining([
        "runtime_allow_tracegate_review",
        "runtime_allow_tracegate_requires_approval",
      ]),
    );
    expect(approvalReview.gapCategory).toBe("approval_gap");
  });

  it("records a policy snapshot before tool input is mutated by execution", async () => {
    const traceSink = createMemoryTraceSink();
    const contract = defineToolContract({
      name: "mutateInput",
      riskTier: "low",
      inputSchema: z.object({
        value: z.string(),
      }),
    });
    const harness = createHarness({ traceSink });
    const mutateInput = harness.wrapTool(contract, async (input) => {
      input.value = "mutated";
      return { value: input.value };
    });

    await mutateInput({ value: "original" });

    expect(traceSink.events.at(1)).toMatchObject({
      type: "tool.started",
      record: {
        input: {
          value: "original",
        },
      },
    });
    expect(traceSink.events.at(2)).toMatchObject({
      type: "tool.succeeded",
      record: {
        input: {
          value: "original",
        },
        output: {
          value: "mutated",
        },
      },
    });
  });
});
