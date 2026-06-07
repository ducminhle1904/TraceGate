import { tool } from "@langchain/core/tools";
import type { ToolContract, ToolRuntimeContext } from "@tracegate/core";
import type { z } from "zod";

import { resolveDescription, resolveHarness, type TraceGateAdapterOptions } from "./common.js";

export type TraceGateLangGraphToolOptions = TraceGateAdapterOptions;

export function createTraceGateLangGraphTool<TInputSchema extends z.ZodType<unknown>, TResult>(
  contract: ToolContract<TInputSchema>,
  execute: (
    input: z.infer<TInputSchema>,
    context: ToolRuntimeContext,
  ) => Promise<TResult> | TResult,
  options: TraceGateLangGraphToolOptions = {},
): ReturnType<typeof tool> {
  const harness = resolveHarness(options);
  const wrapped = harness.wrapTool(contract, execute);

  return tool(async (input) => wrapped(input as z.input<TInputSchema>), {
    name: contract.name,
    description: resolveDescription(options.description, contract.description, contract.name),
    schema: contract.inputSchema as never,
  }) as ReturnType<typeof tool>;
}
