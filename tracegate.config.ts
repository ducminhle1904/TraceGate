import { defineTraceGateConfig } from "@tracegate/cli/config";
import {
  createHarness,
  createMemoryTraceSink,
  defineMatrix,
  defineToolContract,
} from "@tracegate/core";
import { z } from "zod";

const lookupOrderContract = defineToolContract({
  name: "lookupOrder",
  description: "Read an order summary.",
  riskTier: "read",
  inputSchema: z.object({
    orderId: z.string(),
  }),
});

const sendEmailContract = defineToolContract({
  name: "sendEmail",
  description: "Send a customer email.",
  riskTier: "high",
  requiresApproval: true,
  inputSchema: z.object({
    to: z.string().email(),
    body: z.string(),
  }),
});

export default defineTraceGateConfig({
  matrix: defineMatrix([
    {
      id: "root-read-only-tool",
      prompt: "Look up one order without side effects.",
      expect: {
        requiredTools: ["lookupOrder"],
        outputKeys: ["answer"],
      },
    },
    {
      id: "blocks-email-without-approval",
      prompt: "Try to send an email without approval.",
      expect: {
        requiredTools: ["sendEmail"],
        requiredPolicyVerdict: "review",
        outputKeys: ["blocked"],
        redactionChecks: ["secret-token"],
      },
    },
  ]),
  async runCase({ case: matrixCase }) {
    const traceSink = createMemoryTraceSink();
    const harness = createHarness({ traceSink, redaction: { keys: ["body"] } });

    if (matrixCase.id === "blocks-email-without-approval") {
      const sendEmail = harness.wrapTool(sendEmailContract, async () => ({ sent: true }));
      try {
        await sendEmail({
          to: "customer@example.com",
          body: "Internal secret-token should never appear in traces.",
        });
      } catch {
        await harness.finishRun("blocked");
        return {
          events: traceSink.events,
          output: { blocked: true },
        };
      }
    }

    const lookupOrder = harness.wrapTool(lookupOrderContract, async (input) => ({
      orderId: input.orderId,
      status: "paid",
    }));
    const result = await lookupOrder({ orderId: "order-1" });
    await harness.finishRun();

    return {
      events: traceSink.events,
      output: { answer: result.status },
    };
  },
});
