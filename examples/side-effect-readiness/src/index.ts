import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createJsonlFileTraceSink,
  createRuntimeGate,
  defineToolContract,
  type PolicyEvaluator,
  type RuntimeGateSummary,
} from "@tracegate/core";
import { z } from "zod";

type ProbeId = "validation-block" | "approval-denied" | "policy-block" | "shadow-would-block";

interface ProbeResult {
  id: ProbeId;
  tracePath: string;
  runEventsTracePath: string;
  handlerCalls: number;
  summary: RuntimeGateSummary;
  runEventsSummary: RuntimeGateSummary;
}

const here = dirname(fileURLToPath(import.meta.url));
const tracesDir = join(here, "..", "traces");

const invoiceDraftContract = defineToolContract({
  name: "createInvoiceDraft",
  description: "Persist an invoice draft that may later be sent to a customer.",
  riskTier: "high",
  requiresApproval: true,
  inputSchema: z.object({
    customerId: z.string().min(1),
    invoiceNumber: z.string().min(1),
    amountUsd: z.number().positive(),
  }),
  sideEffects: [{ kind: "database-write", external: false }],
  requiredEvidence: ["invoice-review"],
});

const validInput = {
  customerId: "cust_demo",
  invoiceNumber: "INV-1001",
  amountUsd: 1000,
};

const traceGateBlocks: PolicyEvaluator = ({ contract }) => ({
  status: "block",
  reasons: ["TraceGate policy blocks this side effect in the readiness probe."],
  riskTier: contract.riskTier,
  toolName: contract.name,
  diagnostics: [
    {
      source: "policy",
      rule: "side-effect-readiness-block",
      message: "Readiness fixture intentionally blocks this side effect.",
      riskTier: contract.riskTier,
    },
  ],
});

const hostAllows: PolicyEvaluator = ({ contract }) => ({
  status: "allow",
  reasons: ["Host runtime would allow this side effect."],
  riskTier: contract.riskTier,
  toolName: contract.name,
});

const results = [
  await runProbe("validation-block", false),
  await runProbe("approval-denied", false),
  await runProbe("policy-block", false),
  await runProbe("shadow-would-block", false),
];
for (const result of results) {
  assertProbe(result);
}

console.log(
  JSON.stringify(
    {
      probes: results.map((result) => ({
        id: result.id,
        tracePath: result.tracePath,
        runEventsTracePath: result.runEventsTracePath,
        handlerCalls: result.handlerCalls,
        boundary: summarize(result.summary),
        runEvents: summarize(result.runEventsSummary),
      })),
    },
    null,
    2,
  ),
);

async function runProbe(id: ProbeId, traceRunEvents: boolean): Promise<ProbeResult> {
  const boundary = await executeProbe(id, traceRunEvents);
  const runEvents = await executeProbe(id, true);
  return {
    id,
    tracePath: boundary.tracePath,
    runEventsTracePath: runEvents.tracePath,
    handlerCalls: boundary.handlerCalls,
    summary: boundary.summary,
    runEventsSummary: runEvents.summary,
  };
}

async function executeProbe(
  id: ProbeId,
  traceRunEvents: boolean,
): Promise<{ tracePath: string; handlerCalls: number; summary: RuntimeGateSummary }> {
  const tracePath = join(tracesDir, `${id}${traceRunEvents ? "-run-events" : ""}.jsonl`);
  await rm(tracePath, { force: true });
  await mkdir(dirname(tracePath), { recursive: true });

  const summaries: RuntimeGateSummary[] = [];
  const traceSink = createJsonlFileTraceSink(tracePath);
  let handlerCalls = 0;
  const gate = createRuntimeGate({
    mode: id === "shadow-would-block" ? "shadow" : "enforce",
    traceRunEvents,
    traceSink,
    onSummary(summary) {
      summaries.push(summary);
    },
    enforcement: { toolNames: [invoiceDraftContract.name] },
    ...(id === "validation-block"
      ? { enforcement: { validationOnly: true, toolNames: [invoiceDraftContract.name] } }
      : {}),
    ...(id === "approval-denied"
      ? {
          approvalHandler: () => ({
            status: "denied" as const,
            reason: "Readiness probe denies approval before handler execution.",
          }),
        }
      : {}),
    ...(id === "policy-block" || id === "shadow-would-block"
      ? { policyEvaluator: traceGateBlocks }
      : {}),
    ...(id === "shadow-would-block" ? { runtimeVerdictEvaluator: hostAllows } : {}),
  });
  const createInvoiceDraft = gate.wrapTool(invoiceDraftContract, async (input) => {
    handlerCalls += 1;
    return { draftId: `draft_${input.invoiceNumber}` };
  });

  try {
    await createInvoiceDraft(
      id === "validation-block" ? { ...validInput, invoiceNumber: "" } : validInput,
    );
  } catch {
    // Blocked probes are expected to throw before the handler executes.
  }
  await traceSink.flush?.();

  const summary = summaries.at(-1);
  if (!summary) {
    throw new Error(`Probe ${id} did not emit a RuntimeGateSummary.`);
  }
  return { tracePath, handlerCalls, summary };
}

function assertProbe(result: ProbeResult): void {
  const summary = result.summary;
  if (result.id === "shadow-would-block") {
    assert(summary.handlerExecuted, "shadow probe should execute the handler");
    assert(summary.sideEffectPrevented === false, "shadow mode should not claim prevention");
    assert(
      summary.wouldHaveExecutedInShadow === false,
      "shadow probe should show TraceGate would block",
    );
    return;
  }

  assert(result.handlerCalls === 0, `${result.id} should not call the handler`);
  assert(summary.handlerExecuted === false, `${result.id} should report handlerExecuted=false`);
  assert(summary.sideEffectPrevented === true, `${result.id} should prevent side effects`);
  if (result.id === "validation-block") {
    assert(
      summary.handlerSkippedReason === "validation-failed",
      "validation probe skipped reason drifted",
    );
  }
  if (result.id === "approval-denied") {
    assert(
      summary.handlerSkippedReason === "approval-denied",
      "approval probe skipped reason drifted",
    );
  }
  if (result.id === "policy-block") {
    assert(
      summary.handlerSkippedReason === "policy-blocked",
      "policy probe skipped reason drifted",
    );
  }
}

function summarize(summary: RuntimeGateSummary) {
  return {
    mode: summary.mode,
    toolName: summary.toolName,
    riskTier: summary.riskTier,
    status: summary.status,
    finalVerdict: summary.finalVerdict?.status,
    handlerExecuted: summary.handlerExecuted,
    toolExecuted: summary.toolExecuted,
    handlerSkippedReason: summary.handlerSkippedReason,
    sideEffectPrevented: summary.sideEffectPrevented,
    wouldHaveExecutedInShadow: summary.wouldHaveExecutedInShadow,
    enforcementApplied: summary.enforcementApplied,
    validationOnly: summary.validationOnly,
    diagnostics: summary.diagnostics.map((diagnostic) => `${diagnostic.source}:${diagnostic.rule}`),
    shadowComparison: summary.shadowComparison?.classifications,
  };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
