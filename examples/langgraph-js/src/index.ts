import { createTraceGateLangGraphTool } from "@tracegate/adapters/langgraph";
import { createHarness, createMemoryTraceSink, defineToolContract } from "@tracegate/core";
import { z } from "zod";

const traceSink = createMemoryTraceSink();
const harness = createHarness({
  surface: "langgraph-js-example",
  traceSink,
});

const searchContract = defineToolContract({
  name: "searchKnowledgeBase",
  description: "Search an internal knowledge base.",
  riskTier: "read",
  inputSchema: z.object({
    query: z.string().min(1),
  }),
});

const searchKnowledgeBase = createTraceGateLangGraphTool(
  searchContract,
  async ({ query }) => ({
    query,
    hits: ["TraceGate contract docs", "TraceGate replay docs"],
  }),
  { harness },
);

const invokeTool = searchKnowledgeBase.invoke.bind(searchKnowledgeBase) as (
  input: unknown,
) => Promise<unknown>;
const output = await invokeTool({ query: "tool contracts" });
const run = await harness.finishRun("succeeded");

console.log(
  JSON.stringify(
    {
      toolName: searchKnowledgeBase.name,
      output,
      runId: run.id,
      events: traceSink.events.map((event) => event.type),
    },
    null,
    2,
  ),
);
