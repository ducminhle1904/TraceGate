import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import {
  createHarness,
  createMemoryTraceSink,
  defineToolContract,
  TraceGateReviewRequiredError,
} from "@tracegate/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { toBraintrustEvalRows } from "../src/braintrust.js";
import { createLangfuseTraceSink, toLangfuseTraceEvents } from "../src/langfuse.js";
import { createTraceGateLangGraphTool } from "../src/langgraph.js";
import { createTraceGateOpenAIAgentsTool } from "../src/openai-agents.js";
import {
  createOpenTelemetryTraceSink,
  mapTraceEventToOpenTelemetryAttributes,
} from "../src/opentelemetry.js";

const inputSchema = z.object({ value: z.string() });

describe("framework adapters", () => {
  it("creates an OpenAI Agents function tool from a TraceGate contract", async () => {
    const sink = createMemoryTraceSink();
    const harness = createHarness({ traceSink: sink });
    const contract = defineToolContract({
      name: "openai_lookup",
      description: "Look up a value.",
      riskTier: "low",
      inputSchema,
    });

    const openAiTool = createTraceGateOpenAIAgentsTool(
      contract,
      async (input) => ({ ok: input.value }),
      { harness },
    );

    await expect(
      openAiTool.invoke({} as never, JSON.stringify({ value: "alpha" })),
    ).resolves.toEqual({
      ok: "alpha",
    });
    expect(openAiTool.name).toBe("openai_lookup");
    expect(sink.events.map((event) => event.type)).toEqual([
      "run.started",
      "tool.started",
      "tool.succeeded",
    ]);
  });

  it("surfaces TraceGate runtime errors through the OpenAI Agents adapter", async () => {
    const harness = createHarness({ traceSink: createMemoryTraceSink() });
    const contract = defineToolContract({
      name: "openai_blocked_email",
      riskTier: "high",
      requiresApproval: true,
      inputSchema,
    });
    const openAiTool = createTraceGateOpenAIAgentsTool(contract, async () => "sent", {
      harness,
    });

    await expect(
      openAiTool.invoke({} as never, JSON.stringify({ value: "needs approval" })),
    ).rejects.toBeInstanceOf(TraceGateReviewRequiredError);
  });

  it("creates a LangGraph-compatible structured tool from a TraceGate contract", async () => {
    const sink = createMemoryTraceSink();
    const harness = createHarness({ traceSink: sink });
    const contract = defineToolContract({
      name: "langgraph_lookup",
      description: "Look up a value.",
      riskTier: "low",
      inputSchema,
    });

    const langGraphTool = createTraceGateLangGraphTool(
      contract,
      async (input) => ({ ok: input.value }),
      { harness },
    );

    const invokeLangGraph = langGraphTool.invoke.bind(langGraphTool) as (
      input: unknown,
    ) => Promise<unknown>;
    await expect(invokeLangGraph({ value: "beta" })).resolves.toEqual({ ok: "beta" });
    expect(langGraphTool.name).toBe("langgraph_lookup");
    expect(sink.events.map((event) => event.type)).toEqual([
      "run.started",
      "tool.started",
      "tool.succeeded",
    ]);
  });

  it("calls onTraceEvent when the adapter creates the harness", async () => {
    const seen: string[] = [];
    const contract = defineToolContract({
      name: "callback_lookup",
      riskTier: "low",
      inputSchema,
    });
    const langGraphTool = createTraceGateLangGraphTool(
      contract,
      async (input) => ({ ok: input.value }),
      {
        onTraceEvent(event) {
          seen.push(event.type);
        },
      },
    );

    const invokeLangGraph = langGraphTool.invoke.bind(langGraphTool) as (
      input: unknown,
    ) => Promise<unknown>;
    await invokeLangGraph({ value: "callback" });

    expect(seen).toEqual(["run.started", "tool.started", "tool.succeeded"]);
  });

  it("rejects onTraceEvent when an existing harness is provided", () => {
    const harness = createHarness();
    const contract = defineToolContract({
      name: "callback_existing_harness",
      riskTier: "low",
      inputSchema,
    });

    expect(() =>
      createTraceGateLangGraphTool(contract, async (input) => ({ ok: input.value }), {
        harness,
        onTraceEvent() {},
      }),
    ).toThrow("onTraceEvent can only be used when the adapter creates the harness");
  });

  it("surfaces TraceGate runtime errors through the LangGraph adapter", async () => {
    const contract = defineToolContract({
      name: "langgraph_blocked_email",
      riskTier: "high",
      requiresApproval: true,
      inputSchema,
    });
    const langGraphTool = createTraceGateLangGraphTool(contract, async () => "sent");

    const invokeLangGraph = langGraphTool.invoke.bind(langGraphTool) as (
      input: unknown,
    ) => Promise<unknown>;
    await expect(invokeLangGraph({ value: "needs approval" })).rejects.toBeInstanceOf(
      TraceGateReviewRequiredError,
    );
  });
});

describe("observability exporters", () => {
  it("maps TraceGate events to OpenTelemetry attributes and in-memory spans", async () => {
    const memorySink = createMemoryTraceSink();
    const harness = createHarness({ traceSink: memorySink });
    const contract = defineToolContract({
      name: "otel_lookup",
      riskTier: "low",
      inputSchema,
    });
    const wrapped = harness.wrapTool(contract, async (input) => ({ ok: input.value }));
    await wrapped({ value: "gamma" });

    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    const otelSink = createOpenTelemetryTraceSink({
      tracer: provider.getTracer("tracegate-test"),
    });

    for (const event of memorySink.events) {
      await otelSink.write(event);
    }
    await provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(memorySink.events.length);
    expect(spans.at(1)?.attributes["tracegate.tool.name"]).toBe("otel_lookup");
    const toolEvent = memorySink.events[1];
    expect(toolEvent).toBeDefined();
    expect(
      mapTraceEventToOpenTelemetryAttributes(toolEvent as NonNullable<typeof toolEvent>),
    ).toMatchObject({
      "tracegate.run.id": memorySink.events[0]?.runId,
    });
  });

  it("flushes OpenTelemetry sinks and ends spans if endSpan throws", async () => {
    const memorySink = createMemoryTraceSink();
    const harness = createHarness({ traceSink: memorySink });
    const contract = defineToolContract({
      name: "otel_flush_lookup",
      riskTier: "low",
      inputSchema,
    });
    await harness.wrapTool(contract, async (input) => ({ ok: input.value }))({ value: "flush" });

    const ended: boolean[] = [];
    let flushed = false;
    const otelSink = createOpenTelemetryTraceSink({
      tracer: {
        startSpan() {
          return {
            end() {
              ended.push(true);
            },
            setStatus() {
              return undefined;
            },
          };
        },
      } as never,
      endSpan() {
        throw new Error("callback failed");
      },
      flush() {
        flushed = true;
      },
    });

    expect(() =>
      otelSink.write(memorySink.events[0] as NonNullable<(typeof memorySink.events)[0]>),
    ).toThrow("callback failed");
    await otelSink.flush?.();

    expect(ended).toEqual([true]);
    expect(flushed).toBe(true);
  });

  it("creates Braintrust-compatible eval rows from matrix and replay inputs", () => {
    const matrixRows = toBraintrustEvalRows({
      version: "1",
      status: "failed",
      counts: { total: 1, passed: 0, failed: 1 },
      cases: [
        {
          id: "case-1",
          status: "failed",
          durationMs: 12,
          failures: ["Expected tool sequence."],
          runId: "run-1",
          traceEventCount: 3,
        },
      ],
    });

    expect(matrixRows[0]).toMatchObject({
      input: { caseId: "case-1" },
      scores: { passed: 0, failureCount: 1 },
      metadata: { kind: "tracegate.matrix.case", runId: "run-1" },
    });

    const replayRows = toBraintrustEvalRows({
      caseId: "replay-1",
      events: [],
      failures: [],
    });
    expect(replayRows[0]?.metadata.kind).toBe("tracegate.replay");
    expect(replayRows[0]?.scores?.passed).toBe(1);
  });

  it("maps and writes Langfuse-compatible trace events without live credentials", async () => {
    const memorySink = createMemoryTraceSink();
    const harness = createHarness({ traceSink: memorySink });
    const contract = defineToolContract({
      name: "langfuse_lookup",
      riskTier: "low",
      inputSchema,
    });
    await harness.wrapTool(contract, async (input) => ({ ok: input.value }))({ value: "delta" });

    const mapped = toLangfuseTraceEvents(memorySink.events, {
      metadata: { suite: "adapters" },
    });
    expect(mapped.map((event) => event.type)).toEqual([
      "run.started",
      "tool.started",
      "tool.succeeded",
    ]);
    expect(mapped[1]?.metadata.toolName).toBe("langfuse_lookup");

    const written: unknown[] = [];
    const sink = createLangfuseTraceSink({
      writer: (event) => {
        written.push(event);
      },
    });
    const firstEvent = memorySink.events[0];
    expect(firstEvent).toBeDefined();
    await sink.write(firstEvent as NonNullable<typeof firstEvent>);
    expect(written).toHaveLength(1);
  });
});
