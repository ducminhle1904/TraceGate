import { createTraceGateOpenAIAgentsTool } from "@tracegate/adapters/openai-agents";
import { createHarness, createMemoryTraceSink, defineToolContract } from "@tracegate/core";
import { z } from "zod";

const traceSink = createMemoryTraceSink();
const harness = createHarness({
  surface: "openai-agents-example",
  traceSink,
});

const lookupContract = defineToolContract({
  name: "lookupCustomer",
  description: "Look up a customer by id.",
  riskTier: "read",
  inputSchema: z.object({
    customerId: z.string().min(1),
  }),
});

const lookupCustomer = createTraceGateOpenAIAgentsTool(
  lookupContract,
  async ({ customerId }) => ({
    customerId,
    tier: "enterprise",
  }),
  { harness },
);

const output = await lookupCustomer.invoke({} as never, JSON.stringify({ customerId: "cust_123" }));
const run = await harness.finishRun("succeeded");

console.log(
  JSON.stringify(
    {
      toolName: lookupCustomer.name,
      output,
      runId: run.id,
      events: traceSink.events.map((event) => event.type),
    },
    null,
    2,
  ),
);
