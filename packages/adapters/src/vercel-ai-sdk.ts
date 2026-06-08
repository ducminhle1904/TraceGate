import type {
  InferToolInput,
  InferToolOutput,
  ToolContract,
  TraceGateInputSchema,
} from "@tracegate/core";
import { type Tool, tool } from "ai";

import {
  resolveDescription,
  resolveRuntimeGate,
  type TraceGateRuntimeAdapterOptions,
} from "./common.js";

export type TraceGateVercelAIToolOptions = TraceGateRuntimeAdapterOptions;

export function createTraceGateVercelAITool<TInputSchema extends TraceGateInputSchema, TResult>(
  contract: ToolContract<TInputSchema>,
  execute: (input: InferToolOutput<TInputSchema>) => Promise<TResult> | TResult,
  options: TraceGateVercelAIToolOptions = {},
): Tool<InferToolInput<TInputSchema>, TResult | unknown> {
  const runtimeGate = resolveRuntimeGate(options);
  const wrapped = runtimeGate.wrapTool(contract, execute);

  return tool<InferToolInput<TInputSchema>, TResult | unknown>({
    description: resolveDescription(options.description, contract.description, contract.name),
    inputSchema: contract.inputSchema as never,
    async execute(input) {
      return wrapped(input as InferToolInput<TInputSchema>);
    },
  }) as Tool<InferToolInput<TInputSchema>, TResult | unknown>;
}
