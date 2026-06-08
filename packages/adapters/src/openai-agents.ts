import { tool } from "@openai/agents";
import type {
  InferToolInput,
  InferToolOutput,
  ToolContract,
  ToolRuntimeContext,
} from "@tracegate/core";
import type { z } from "zod";

import { resolveDescription, resolveHarness, type TraceGateAdapterOptions } from "./common.js";

export type TraceGateOpenAIAgentsToolOptions = TraceGateAdapterOptions;

export function createTraceGateOpenAIAgentsTool<TInputSchema extends z.ZodType<unknown>, TResult>(
  contract: ToolContract<TInputSchema>,
  execute: (
    input: InferToolOutput<TInputSchema>,
    context: ToolRuntimeContext,
  ) => Promise<TResult> | TResult,
  options: TraceGateOpenAIAgentsToolOptions = {},
): ReturnType<typeof tool> {
  const harness = resolveHarness(options);
  const wrapped = harness.wrapTool(contract, execute);

  return tool({
    name: contract.name,
    description: resolveDescription(options.description, contract.description, contract.name),
    parameters: contract.inputSchema as never,
    strict: true,
    errorFunction: null,
    async execute(input) {
      return wrapped(input as InferToolInput<TInputSchema>);
    },
  }) as ReturnType<typeof tool>;
}
