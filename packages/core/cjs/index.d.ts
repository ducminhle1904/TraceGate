export type TraceGateCoreModule = typeof import("../dist/index.js");

export function loadTraceGateCore(): Promise<TraceGateCoreModule>;
