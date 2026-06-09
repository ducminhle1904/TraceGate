import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../src/cli.js";
import { loadTypeScriptModule } from "../src/config-loader.js";

const timestamp = "2026-06-07T00:00:00.000Z";

describe("tracegate CLI", () => {
  it("loads tracegate.config.ts and emits JSON report", async () => {
    await withTempDir(async (cwd) => {
      await writeConfig(
        cwd,
        `const answer: string = "ready";

export default {
  matrix: [
    {
      id: "passes",
      prompt: "Look up an order",
      expect: {
        requiredTools: ["lookupOrder"],
        outputKeys: ["answer"],
        toolInputIncludes: {
          lookupOrder: { orderId: "order-1" },
        },
      },
    },
  ],
  async runCase() {
    return {
      output: { answer },
      events: [
        ${toolEvent("tool.started", "started", "lookupOrder", { orderId: "order-1" })},
      ],
    };
  },
};
`,
      );
      const io = createIo(cwd);

      await expect(runCli(["test", "--json"], io)).resolves.toBe(0);

      const report = JSON.parse(io.stdoutText());
      expect(report).toMatchObject({
        status: "passed",
        counts: { total: 1, passed: 1, failed: 0 },
        cases: [{ id: "passes", status: "passed", traceEventCount: 1 }],
      });
    });
  });

  it("loads tracegate.config.ts with static TraceGate package imports", async () => {
    await withTempDir(async (cwd) => {
      await writeConfig(
        cwd,
        `import { defineMatrix } from "@tracegate/core";
import { defineTraceGateConfig } from "@tracegate/cli/config";

export default defineTraceGateConfig({
  matrix: defineMatrix([
    {
      id: "static-imports",
      prompt: "Exercise static imports",
      expect: {
        requiredTools: ["lookupOrder"],
        outputKeys: ["answer"],
      },
    },
  ]),
  async runCase() {
    return {
      output: { answer: "ready" },
      events: [
        ${toolEvent("tool.started", "started", "lookupOrder", {})},
      ],
    };
  },
});
`,
      );
      const io = createIo(cwd);

      await expect(runCli(["test", "--json"], io)).resolves.toBe(0);
      expect(JSON.parse(io.stdoutText())).toMatchObject({
        status: "passed",
        cases: [{ id: "static-imports", status: "passed" }],
      });
    });
  });

  it("prints runtime policy diagnostics from failed runCase calls", async () => {
    await withTempDir(async (cwd) => {
      await writeConfig(
        cwd,
        `import { createHarness, defineToolContract } from "@tracegate/core";
import { z } from "zod";

const contract = defineToolContract({
  name: "issueRefund",
  riskTier: "high",
  inputSchema: z.object({ orderId: z.string() }),
});

export default {
  matrix: [{ id: "blocked-runtime", prompt: "Issue refund", expect: {} }],
  async runCase() {
    const harness = createHarness({
      policyEvaluator: ({ contract }) => ({
        status: "block",
        reasons: ["Blocked by test policy."],
        riskTier: contract.riskTier,
        toolName: contract.name,
        diagnostics: [
          {
            source: "policy",
            rule: "blocked-risk-tier",
            message: "Policy blocks risk tier high.",
            riskTier: contract.riskTier,
          },
        ],
      }),
    });
    const refund = harness.wrapTool(contract, async () => ({ ok: true }));
    await refund({ orderId: "order-1" });
    return { output: {} };
  },
};`,
      );
      const io = createIo(cwd);

      await expect(runCli(["test"], io)).resolves.toBe(1);

      expect(io.stdoutText()).toContain("riskTier=high");
      expect(io.stdoutText()).toContain("reasons=Blocked by test policy.");
      expect(io.stdoutText()).toContain("handlerExecuted=false");
      expect(io.stdoutText()).toContain("handlerSkippedReason=policy-blocked");
      expect(io.stdoutText()).toContain("sideEffectPrevented=true");
      expect(io.stdoutText()).toContain("diagnostics=policy:blocked-risk-tier");
      expect(io.stdoutText()).toContain("runtime:execution-skipped");
    });
  });

  it("prints denied approval diagnostics from matrix verdict drift", async () => {
    await withTempDir(async (cwd) => {
      await writeConfig(
        cwd,
        `import {
  createHarness,
  createMemoryTraceSink,
  createPolicyEvaluator,
  definePolicy,
  defineToolContract,
} from "@tracegate/core";
import { z } from "zod";

const contract = defineToolContract({
  name: "sendEmail",
  riskTier: "high",
  inputSchema: z.object({ to: z.string() }),
});

export default {
  matrix: [
    {
      id: "approval-denied",
      prompt: "Send a guarded email",
      expect: { requiredPolicyVerdict: "review" },
    },
  ],
  async runCase() {
    const traceSink = createMemoryTraceSink();
    let toolExecuted = false;
    const harness = createHarness({
      traceSink,
      policyEvaluator: createPolicyEvaluator(
        definePolicy({ requireApprovalForRiskTiers: ["high"] }),
      ),
      approvalHandler: () => ({ status: "denied", reason: "Approver rejected the email." }),
    });
    const sendEmail = harness.wrapTool(contract, async () => {
      toolExecuted = true;
      return { sent: true };
    });
    try {
      await sendEmail({ to: "customer@example.com" });
    } catch {
      // Matrix assertions inspect the trace; this case intentionally fails expected verdict.
    }
    return {
      output: { toolExecuted },
      events: traceSink.events,
    };
  },
};`,
      );
      const io = createIo(cwd);

      await expect(runCli(["test"], io)).resolves.toBe(1);

      expect(io.stdoutText()).toContain('Expected policy verdict "review", got block.');
      expect(io.stdoutText()).toContain("tool=sendEmail");
      expect(io.stdoutText()).toContain("riskTier=high");
      expect(io.stdoutText()).toContain("finalVerdict=block");
      expect(io.stdoutText()).toContain("approval=denied");
      expect(io.stdoutText()).toContain("handlerExecuted=false");
      expect(io.stdoutText()).toContain("handlerSkippedReason=approval-denied");
      expect(io.stdoutText()).toContain("sideEffectPrevented=true");
      expect(io.stdoutText()).toContain("toolExecuted=false");
      expect(io.stdoutText()).toContain("policy:approval-denied");
      expect(io.stdoutText()).toContain("approval-handler:approval-denied");
      expect(io.stdoutText()).toContain("runtime:execution-skipped");
    });
  });

  it("does not crash when foreign errors include partial verdict fields", async () => {
    await withTempDir(async (cwd) => {
      await writeConfig(
        cwd,
        `export default {
  matrix: [{ id: "foreign-error", prompt: "Throw partial verdict", expect: {} }],
  async runCase() {
    const error = new Error("foreign policy wrapper failed");
    error.verdict = { status: "block" };
    throw error;
  },
};`,
      );
      const io = createIo(cwd);

      await expect(runCli(["test"], io)).resolves.toBe(1);

      expect(io.stdoutText()).toContain("runCase threw: foreign policy wrapper failed");
      expect(io.stdoutText()).not.toContain("Cannot read");
    });
  });

  it("summarizes non-JSON output without crashing", async () => {
    await withTempDir(async (cwd) => {
      await writeConfig(
        cwd,
        `export default {
  matrix: [{ id: "function-output", prompt: "Return a function", expect: {} }],
  async runCase() {
    return {
      output: () => "ok",
      events: [${toolEvent("tool.started", "started", "lookupOrder", {})}],
    };
  },
};`,
      );
      const io = createIo(cwd);

      await expect(runCli(["test", "--json"], io)).resolves.toBe(0);

      expect(JSON.parse(io.stdoutText()).cases[0].outputSummary).toEqual(expect.any(String));
    });
  });

  it("creates starter config and refuses to overwrite it", async () => {
    await withTempDir(async (cwd) => {
      const io = createIo(cwd);

      await expect(runCli(["init"], io)).resolves.toBe(0);
      await expect(readFile(join(cwd, "tracegate.config.ts"), "utf8")).resolves.toContain(
        "defineTraceGateConfig",
      );
      await expect(
        readFile(join(cwd, "tracegate/fixtures/example-runtime.ts"), "utf8"),
      ).resolves.toContain("defineReplayFixture");
      await expect(
        readFile(join(cwd, "tracegate/traces/example-runtime.jsonl"), "utf8"),
      ).resolves.toContain("tool.succeeded");
      await expect(readFile(join(cwd, "tracegate/redaction-check.ts"), "utf8")).resolves.toContain(
        "assertNoSecretLikeValues",
      );

      const testIo = createIo(cwd);
      await expect(runCli(["test", "--json"], testIo)).resolves.toBe(0);
      expect(JSON.parse(testIo.stdoutText())).toMatchObject({
        status: "passed",
        cases: [{ id: "example-runtime", status: "passed" }],
      });

      const replayIo = createIo(cwd);
      await expect(
        runCli(
          [
            "replay-runtime",
            "tracegate/fixtures/example-runtime.ts",
            "--trace",
            "tracegate/traces/example-runtime.jsonl",
            "--json",
          ],
          replayIo,
        ),
      ).resolves.toBe(0);
      expect(JSON.parse(replayIo.stdoutText())).toMatchObject({ status: "passed" });

      await expect(
        loadTypeScriptModule(join(cwd, "tracegate/redaction-check.ts")),
      ).resolves.toEqual({});

      await expect(runCli(["init"], createIo(cwd))).resolves.toBe(1);

      const forceIo = createIo(cwd);
      await expect(runCli(["init", "--force"], forceIo)).resolves.toBe(0);
      expect(forceIo.stdoutText()).toContain("Next commands:");
    });
  });

  it("fails required, forbidden, ordered, and tool input assertions clearly", async () => {
    await withTempDir(async (cwd) => {
      await writeConfig(
        cwd,
        `export default {
  matrix: [
    {
      id: "fails-tools",
      prompt: "Use the right tool",
      expect: {
        requiredTools: ["lookupOrder"],
        forbiddenTools: ["sendEmail"],
        orderedToolSequence: ["lookupOrder", "sendEmail"],
        toolInputIncludes: {
          lookupOrder: { orderId: "expected" },
        },
      },
    },
  ],
  async runCase() {
    return {
      events: [
        ${toolEvent("tool.started", "started", "sendEmail", { to: "a@example.com" })},
      ],
    };
  },
};`,
      );
      const io = createIo(cwd);

      await expect(runCli(["test"], io)).resolves.toBe(1);

      expect(io.stdoutText()).toContain('Expected tool "lookupOrder" to be called.');
      expect(io.stdoutText()).toContain('Expected tool "sendEmail" not to be called.');
      expect(io.stdoutText()).toContain("Expected tool order lookupOrder -> sendEmail");
      expect(io.stdoutText()).toContain('Expected tool "lookupOrder" input to include');
    });
  });

  it("fails policy, evidence, output, and redaction assertions clearly", async () => {
    await withTempDir(async (cwd) => {
      await writeConfig(
        cwd,
        `export default {
  matrix: [
    {
      id: "fails-policy",
      prompt: "Block risky behavior",
      expect: {
        requiredPolicyVerdict: "block",
        requiredEvidence: ["approval"],
        outputKeys: ["summary"],
        redactionChecks: ["secret-token"],
      },
    },
  ],
  async runCase() {
    return {
      output: {},
      events: [
        ${toolEvent("tool.started", "started", "sendEmail", { token: "secret-token" }, "allow")},
      ],
    };
  },
};`,
      );
      const io = createIo(cwd);

      await expect(runCli(["test"], io)).resolves.toBe(1);

      expect(io.stdoutText()).toContain('Expected policy verdict "block", got allow.');
      expect(io.stdoutText()).toContain('Expected evidence matching "approval".');
      expect(io.stdoutText()).toContain('Expected output key "summary".');
      expect(io.stdoutText()).toContain('Expected redaction check "secret-token"');
    });
  });

  it("filters by exact case id and fails when the case is missing", async () => {
    await withTempDir(async (cwd) => {
      await writeConfig(
        cwd,
        `export default {
  matrix: [
    { id: "one", prompt: "One", expect: {} },
    { id: "two", prompt: "Two", expect: {} },
  ],
  async runCase({ case: matrixCase }) {
    return {
      output: { id: matrixCase.id },
      events: [${toolEvent("tool.started", "started", "lookupOrder", {})}],
    };
  },
};`,
      );

      const selected = createIo(cwd);
      await expect(runCli(["test", "--case", "two", "--json"], selected)).resolves.toBe(0);
      expect(
        JSON.parse(selected.stdoutText()).cases.map((result: { id: string }) => result.id),
      ).toEqual(["two"]);

      const missing = createIo(cwd);
      await expect(runCli(["test", "--case", "missing"], missing)).resolves.toBe(1);
      expect(missing.stderrText()).toContain('No matrix case found with id "missing".');

      const empty = createIo(cwd);
      await expect(runCli(["test", "--case", ""], empty)).resolves.toBe(1);
      expect(empty.stderrText()).toContain("--case must not be empty.");
    });
  });

  it("filters policy-related cases and writes JUnit XML", async () => {
    await withTempDir(async (cwd) => {
      await writeConfig(
        cwd,
        `export default {
  matrix: [
    { id: "plain", prompt: "Plain", expect: {} },
    { id: "policy", prompt: "Policy", expect: { requiredPolicyVerdict: "allow" } },
    { id: "evidence-policy", prompt: "Evidence", expect: { requiredEvidence: ["approval"] } },
  ],
  async runCase() {
    return {
      events: [
        ${toolEvent("tool.started", "started", "lookupOrder", {}, "allow")},
        ${evidenceEvent("approval-1", "user-approval", { approvedBy: "manager" })},
      ],
    };
  },
};`,
      );
      const io = createIo(cwd);

      await expect(
        runCli(["test", "--policy", "--junit", "junit.xml", "--json"], io),
      ).resolves.toBe(0);

      expect(JSON.parse(io.stdoutText()).cases.map((result: { id: string }) => result.id)).toEqual([
        "policy",
        "evidence-policy",
      ]);
      await expect(readFile(join(cwd, "junit.xml"), "utf8")).resolves.toContain(
        '<testcase classname="TraceGate.Matrix" name="policy"',
      );
    });
  });

  it("prefers completed run records over partial events for assertions", async () => {
    await withTempDir(async (cwd) => {
      await writeConfig(
        cwd,
        `export default {
  matrix: [
    {
      id: "run-wins",
      prompt: "Prefer the completed run",
      expect: { requiredPolicyVerdict: "block" },
    },
  ],
  async runCase() {
    return {
      events: [
        ${toolEvent("tool.started", "started", "sendEmail", {}, "allow")},
      ],
      run: {
        id: "run-1",
        startedAt: "${timestamp}",
        status: "blocked",
        toolCalls: [
          ${toolRecord("tool-1", "sendEmail", "blocked", "block")},
        ],
        evidence: [],
      },
    };
  },
};`,
      );
      const io = createIo(cwd);

      await expect(runCli(["test", "--json"], io)).resolves.toBe(0);
      expect(JSON.parse(io.stdoutText()).status).toBe("passed");
    });
  });

  it("uses the final run event when assertions only receive trace events", async () => {
    await withTempDir(async (cwd) => {
      await writeConfig(
        cwd,
        `export default {
  matrix: [
    {
      id: "final-run-event",
      prompt: "Use final run event",
      expect: { requiredPolicyVerdict: "review" },
    },
  ],
  async runCase() {
    return {
      events: [
        ${runEvent("run.started", "running")},
        ${toolEvent("tool.blocked", "blocked", "sendEmail", {}, "review")},
        ${runEvent("run.finished", "blocked", `[${toolRecord("tool-1", "sendEmail", "blocked", "review")}]`)},
      ],
    };
  },
};`,
      );
      const io = createIo(cwd);

      await expect(runCli(["test", "--json"], io)).resolves.toBe(0);
      expect(JSON.parse(io.stdoutText()).status).toBe("passed");
    });
  });

  it("runs matrix cases sequentially by default", async () => {
    await withTempDir(async (cwd) => {
      await writeConfig(
        cwd,
        concurrencyConfig({
          concurrency: undefined,
          delays: { first: 20, second: 5, third: 1 },
        }),
      );
      const io = createIo(cwd);

      await expect(runCli(["test", "--json"], io)).resolves.toBe(0);

      expect(JSON.parse(io.stdoutText()).cases.map((result: { id: string }) => result.id)).toEqual([
        "first",
        "second",
        "third",
      ]);
      expect(
        (globalThis as { __tracegateConcurrency?: { maxActive: number } }).__tracegateConcurrency
          ?.maxActive,
      ).toBe(1);
    });
  });

  it("runs matrix cases with bounded concurrency while preserving report order", async () => {
    await withTempDir(async (cwd) => {
      await writeConfig(
        cwd,
        concurrencyConfig({
          concurrency: 2,
          delays: { first: 30, second: 10, third: 1 },
        }),
      );
      const io = createIo(cwd);

      await expect(runCli(["test", "--json"], io)).resolves.toBe(0);

      expect(JSON.parse(io.stdoutText()).cases.map((result: { id: string }) => result.id)).toEqual([
        "first",
        "second",
        "third",
      ]);
      expect(
        (globalThis as { __tracegateConcurrency?: { maxActive: number } }).__tracegateConcurrency
          ?.maxActive,
      ).toBe(2);
    });
  });

  it("lets CLI concurrency override config concurrency", async () => {
    await withTempDir(async (cwd) => {
      await writeConfig(
        cwd,
        concurrencyConfig({
          concurrency: 1,
          delays: { first: 20, second: 10, third: 1 },
        }),
      );
      const io = createIo(cwd);

      await expect(runCli(["test", "--concurrency", "2", "--json"], io)).resolves.toBe(0);

      expect(
        (globalThis as { __tracegateConcurrency?: { maxActive: number } }).__tracegateConcurrency
          ?.maxActive,
      ).toBe(2);
    });
  });

  it("rejects invalid concurrency values before running cases", async () => {
    await withTempDir(async (cwd) => {
      await writeConfig(
        cwd,
        `globalThis.__tracegateConcurrencyRan = false;
export default {
  matrix: [{ id: "one", prompt: "One", expect: {} }],
  async runCase() {
    globalThis.__tracegateConcurrencyRan = true;
    return { events: [${toolEvent("tool.started", "started", "lookupOrder", {})}] };
  },
};`,
      );
      (globalThis as { __tracegateConcurrencyRan?: boolean }).__tracegateConcurrencyRan = false;

      for (const value of ["0", "-1", "abc", ""]) {
        const io = createIo(cwd);
        await expect(runCli(["test", "--concurrency", value], io)).resolves.toBe(1);
        expect(io.stderrText()).toContain("--concurrency");
      }
      expect(
        (globalThis as { __tracegateConcurrencyRan?: boolean }).__tracegateConcurrencyRan,
      ).toBe(false);
    });
  });

  it("creates replay fixtures from JSONL traces and refuses overwrite", async () => {
    await withTempDir(async (cwd) => {
      await writeFile(
        join(cwd, "trace.jsonl"),
        `${toolEvent("tool.started", "started", "sendEmail", {}, "review")}\n${evidenceEvent(
          "approval-1",
          "user-approval",
          { approvedBy: "manager" },
        )}\n`,
        "utf8",
      );

      const created = createIo(cwd);
      await expect(
        runCli(["fixtures", "create", "trace.jsonl", "--out", "fixtures/fixture.ts"], created),
      ).resolves.toBe(0);
      const fixture = await readFile(join(cwd, "fixtures/fixture.ts"), "utf8");
      expect(fixture).toContain("defineReplayFixture");
      expect(fixture).toContain('"id": "trace"');
      expect(fixture).toContain('"toolSequence"');

      const overwrite = createIo(cwd);
      await expect(
        runCli(["fixtures", "create", "trace.jsonl", "--out", "fixtures/fixture.ts"], overwrite),
      ).resolves.toBe(1);
      expect(overwrite.stderrText()).toContain("Replay fixture already exists");

      const forced = createIo(cwd);
      await expect(
        runCli(
          ["fixtures", "create", "trace.jsonl", "--out", "fixtures/fixture.ts", "--force"],
          forced,
        ),
      ).resolves.toBe(0);

      await writeFile(
        join(cwd, "bad.jsonl"),
        `${toolEvent("tool.started", "started", "sendEmail", {}, "review")}\nnot-json\n`,
        "utf8",
      );
      const malformed = createIo(cwd);
      await expect(
        runCli(["fixtures", "create", "bad.jsonl", "--out", "bad.ts"], malformed),
      ).resolves.toBe(1);
      expect(malformed.stderrText()).toContain("line 2");
    });
  });

  it("creates replay fixtures using a matching matrix case", async () => {
    await withTempDir(async (cwd) => {
      await writeConfig(
        cwd,
        `export default {
  matrix: [{ id: "from-config", prompt: "From config", expect: { requiredTools: ["sendEmail"] } }],
  async runCase() {
    return { events: [${toolEvent("tool.started", "started", "sendEmail", {})}] };
  },
};`,
      );
      await writeFile(
        join(cwd, "trace.jsonl"),
        `${toolEvent("tool.started", "started", "sendEmail", {})}\n`,
        "utf8",
      );

      const io = createIo(cwd);
      await expect(
        runCli(
          ["fixtures", "create", "trace.jsonl", "--out", "fixture.ts", "--case", "from-config"],
          io,
        ),
      ).resolves.toBe(0);

      const fixture = await readFile(join(cwd, "fixture.ts"), "utf8");
      expect(fixture).toContain('"id": "from-config"');
      expect(fixture).toContain('"prompt": "From config"');
      expect(fixture).toContain('"requiredTools"');
    });
  });

  it("creates runtime-gate replay fixtures from tool-boundary JSONL traces", async () => {
    await withTempDir(async (cwd) => {
      await writeFile(
        join(cwd, "runtime-gate.jsonl"),
        `${toolEvent("tool.pre_call", "blocked", "sendEmail", {}, "review", {
          stage: "pre_call",
          evidenceSatisfied: false,
          sideEffectAlreadyOccurred: false,
          preventability: "requires_post_call_evidence",
        })}\n${toolEvent("tool.post_call", "succeeded", "sendEmail", {}, "allow", {
          stage: "post_call",
          runtimeVerdict: "allow",
          evidenceSatisfied: true,
          sideEffectAlreadyOccurred: true,
          preventability: "not_preventable_at_pre_call",
        })}\n`,
        "utf8",
      );

      const io = createIo(cwd);
      await expect(
        runCli(
          [
            "fixtures",
            "create",
            "runtime-gate.jsonl",
            "--runtime-gate",
            "--out",
            "fixtures/runtime-gate.ts",
          ],
          io,
        ),
      ).resolves.toBe(0);

      const fixture = await readFile(join(cwd, "fixtures/runtime-gate.ts"), "utf8");
      expect(fixture).toContain('"sourceKind": "runtime-gate"');
      expect(fixture).toContain('"traceEventCountMode": "tool-boundary"');
      expect(fixture).toContain('"toolEventSequenceMode": "ordered-subset"');
      expect(fixture).toContain('"stageSequenceMode": "ordered-subset"');
      expect(fixture).toContain('"toolEventSequence"');
      expect(fixture).toContain('"stageSequence"');
      expect(fixture).toContain('"traceEventCount": 2');
    });
  });

  it("omits runStatus when creating runtime-gate fixtures from traces with run events", async () => {
    await withTempDir(async (cwd) => {
      await writeFile(
        join(cwd, "runtime-gate-run-events.jsonl"),
        `${runEvent("run.started", "running")}\n${toolEvent(
          "tool.blocked",
          "blocked",
          "sendEmail",
          {},
          "block",
        )}\n${runEvent(
          "run.finished",
          "blocked",
          `[${toolRecord("tool-1", "sendEmail", "blocked", "block")}]`,
        )}\n`,
        "utf8",
      );

      const io = createIo(cwd);
      await expect(
        runCli(
          [
            "fixtures",
            "create",
            "runtime-gate-run-events.jsonl",
            "--runtime-gate",
            "--out",
            "fixtures/runtime-gate.ts",
          ],
          io,
        ),
      ).resolves.toBe(0);

      const fixture = await readFile(join(cwd, "fixtures/runtime-gate.ts"), "utf8");
      expect(fixture).toContain('"sourceKind": "runtime-gate"');
      expect(fixture.match(/"runStatus": "blocked"/g) ?? []).toHaveLength(1);
      expect(fixture).toContain('"traceEventCountMode": "tool-boundary"');
    });
  });

  it("does not report commented TraceGate imports as unresolved", async () => {
    await withTempDir(async (cwd) => {
      await writeConfig(
        cwd,
        `// import "@tracegate/adapters/nope";
const example = 'import "@tracegate/adapters/also-nope"';

export default {
  matrix: [{ id: "ok", prompt: "Ok", expect: {} }],
  async runCase() {
    return { events: [${toolEvent("tool.started", "started", "lookupOrder", {})}] };
  },
};`,
      );

      const io = createIo(cwd);
      await expect(runCli(["doctor"], io)).resolves.toBe(0);
      expect(io.stdoutText()).not.toContain("TraceGate config imports unresolved package subpaths");
    });
  });

  it("replays a fixture and writes JSON and JUnit reports", async () => {
    await withTempDir(async (cwd) => {
      await writeConfig(
        cwd,
        `export default {
  matrix: [],
  async runCase() {
    return {
      output: { blocked: true },
      events: [
        ${toolEvent("tool.started", "started", "sendEmail", {}, "review")},
        ${evidenceEvent("approval-1", "user-approval", { approvedBy: "manager" })},
      ],
    };
  },
};`,
      );
      await writeFile(join(cwd, "fixture.ts"), replayFixtureModule(), "utf8");

      const io = createIo(cwd);
      await expect(
        runCli(["replay", "fixture.ts", "--json", "--junit", "replay.xml"], io),
      ).resolves.toBe(0);

      const report = JSON.parse(io.stdoutText());
      expect(report).toMatchObject({
        status: "passed",
        counts: { total: 1, passed: 1, failed: 0 },
        cases: [{ id: "replay-pass", status: "passed", traceEventCount: 2 }],
      });
      await expect(readFile(join(cwd, "replay.xml"), "utf8")).resolves.toContain(
        '<testcase classname="TraceGate.Matrix" name="replay-pass"',
      );
    });
  });

  it("replays runtime-gate JSONL traces without loading project config", async () => {
    await withTempDir(async (cwd) => {
      await writeFile(
        join(cwd, "fixture.ts"),
        replayFixtureModule({
          expect: {
            toolSequence: ["sendEmail"],
            toolStatuses: { sendEmail: ["started", "succeeded"] },
            policyVerdicts: { sendEmail: ["review", "allow"] },
            evidence: [],
            outputKeys: [],
            traceEventCount: 2,
            traceEventCountMode: "tool-boundary",
          },
          captured: {
            traceEventCount: 2,
          },
        }),
        "utf8",
      );
      await writeFile(
        join(cwd, "current.jsonl"),
        `${toolEvent("tool.started", "started", "sendEmail", {}, "review")}\n${toolEvent(
          "tool.succeeded",
          "succeeded",
          "sendEmail",
          {},
          "allow",
        )}\n`,
        "utf8",
      );

      const io = createIo(cwd);
      await expect(
        runCli(["replay-runtime", "fixture.ts", "--trace", "current.jsonl", "--json"], io),
      ).resolves.toBe(0);

      const report = JSON.parse(io.stdoutText());
      expect(report).toMatchObject({
        status: "passed",
        cases: [{ id: "replay-pass", status: "passed", traceEventCount: 2 }],
      });
    });
  });

  it("replays runtime-gate ordered-subset traces with run lifecycle noise", async () => {
    await withTempDir(async (cwd) => {
      await writeFile(
        join(cwd, "fixture.ts"),
        replayFixtureModule({
          expect: {
            toolSequence: [],
            toolStatuses: {},
            policyVerdicts: {},
            evidence: [],
            outputKeys: [],
            toolEventSequence: [
              {
                type: "tool.blocked",
                toolName: "sendEmail",
                status: "blocked",
                policyVerdict: "block",
              },
            ],
            toolEventSequenceMode: "ordered-subset",
            traceEventCount: 1,
            traceEventCountMode: "tool-boundary",
          },
          captured: {
            traceEventCount: 1,
          },
        }),
        "utf8",
      );
      await writeFile(
        join(cwd, "current.jsonl"),
        `${runEvent("run.started", "running")}\n${toolEvent(
          "tool.started",
          "started",
          "lookupOrder",
          {},
          "allow",
        )}\n${toolEvent("tool.blocked", "blocked", "sendEmail", {}, "block")}\n${runEvent(
          "run.finished",
          "blocked",
        )}\n`,
        "utf8",
      );

      const io = createIo(cwd);
      await expect(
        runCli(["replay-runtime", "fixture.ts", "--trace", "current.jsonl"], io),
      ).resolves.toBe(0);
      expect(io.stdoutText()).toContain("passed");
    });
  });

  it("replays runtime-gate multi-stage traces as an ordered subset", async () => {
    await withTempDir(async (cwd) => {
      await writeFile(
        join(cwd, "fixture.ts"),
        replayFixtureModule({
          expect: {
            toolSequence: [],
            toolStatuses: {},
            policyVerdicts: {},
            evidence: [],
            outputKeys: [],
            toolEventSequence: [
              {
                type: "tool.post_call",
                toolName: "createInvoiceDraft",
                status: "succeeded",
                policyVerdict: "allow",
              },
            ],
            toolEventSequenceMode: "ordered-subset",
            stageSequence: [
              {
                stage: "post_call",
                toolName: "createInvoiceDraft",
                postCallVerdict: "allow",
                runtimeVerdict: "allow",
                evidenceSatisfied: true,
                sideEffectAlreadyOccurred: true,
                preventability: "not_preventable_at_pre_call",
              },
            ],
            stageSequenceMode: "ordered-subset",
            traceEventCount: 1,
            traceEventCountMode: "tool-boundary",
          },
          captured: {
            traceEventCount: 1,
          },
        }),
        "utf8",
      );
      await writeFile(
        join(cwd, "current.jsonl"),
        `${runEvent("run.started", "running")}\n${toolEvent(
          "tool.pre_call",
          "blocked",
          "createInvoiceDraft",
          {},
          "review",
          {
            stage: "pre_call",
            evidenceSatisfied: false,
            sideEffectAlreadyOccurred: false,
            preventability: "requires_post_call_evidence",
          },
        )}\n${toolEvent("tool.post_call", "succeeded", "createInvoiceDraft", {}, "allow", {
          stage: "post_call",
          runtimeVerdict: "allow",
          evidenceSatisfied: true,
          sideEffectAlreadyOccurred: true,
          preventability: "not_preventable_at_pre_call",
        })}\n${runEvent("run.finished", "succeeded")}\n`,
        "utf8",
      );

      const io = createIo(cwd);
      await expect(
        runCli(["replay-runtime", "fixture.ts", "--trace", "current.jsonl"], io),
      ).resolves.toBe(0);
      expect(io.stdoutText()).toContain("passed");
    });
  });

  it("reports runtime-gate ordered-subset approval-denied drift clearly", async () => {
    await withTempDir(async (cwd) => {
      await writeFile(
        join(cwd, "fixture.ts"),
        replayFixtureModule({
          expect: {
            toolSequence: [],
            toolStatuses: {},
            policyVerdicts: {},
            evidence: [],
            outputKeys: [],
            toolEventSequence: [
              {
                type: "tool.blocked",
                toolName: "sendEmail",
                status: "blocked",
                policyVerdict: "block",
              },
            ],
            toolEventSequenceMode: "ordered-subset",
            traceEventCount: 1,
            traceEventCountMode: "tool-boundary",
          },
          captured: {
            traceEventCount: 1,
          },
        }),
        "utf8",
      );
      await writeFile(
        join(cwd, "current.jsonl"),
        `${toolEvent("tool.succeeded", "succeeded", "sendEmail", {}, "allow")}\n`,
        "utf8",
      );

      const io = createIo(cwd);
      await expect(
        runCli(["replay-runtime", "fixture.ts", "--trace", "current.jsonl"], io),
      ).resolves.toBe(1);
      expect(io.stdoutText()).toContain(
        "Expected tool event tool.blocked:sendEmail:blocked verdict=block",
      );
      expect(io.stdoutText()).toContain("Tool event sequence mode: ordered-subset");
      expect(io.stdoutText()).toContain("Trace event count mode: tool-boundary");
    });
  });

  it("reports runtime-gate replay drift with boundary mode diagnostics", async () => {
    await withTempDir(async (cwd) => {
      await writeFile(
        join(cwd, "fixture.ts"),
        replayFixtureModule({
          expect: {
            toolSequence: ["sendEmail"],
            toolStatuses: { sendEmail: ["started", "succeeded"] },
            policyVerdicts: { sendEmail: ["review", "allow"] },
            evidence: [],
            outputKeys: [],
            traceEventCount: 2,
            traceEventCountMode: "tool-boundary",
          },
          captured: {
            traceEventCount: 2,
          },
        }),
        "utf8",
      );
      await writeFile(
        join(cwd, "current.jsonl"),
        `${toolEvent("tool.blocked", "blocked", "lookupOrder", {}, "block")}\n`,
        "utf8",
      );

      const io = createIo(cwd);
      await expect(
        runCli(["replay-runtime", "fixture.ts", "--trace", "current.jsonl"], io),
      ).resolves.toBe(1);

      expect(io.stdoutText()).toContain(
        'Runtime-gate replay compared "replay-pass" using tool-boundary trace event count mode.',
      );
      expect(io.stdoutText()).toContain("Expected tool sequence [sendEmail], got [].");
      expect(io.stdoutText()).toContain(
        'Expected tool statuses for "lookupOrder" [], got [blocked].',
      );
      expect(io.stdoutText()).toContain("Trace event count mode: tool-boundary.");
      expect(io.stdoutText()).toContain("has no run.finished event");
      expect(io.stdoutText()).toContain("Side-effect safety: tool=lookupOrder");
      expect(io.stdoutText()).toContain("handlerExecuted=false");
      expect(io.stdoutText()).toContain("handlerSkippedReason=policy-blocked");
      expect(io.stdoutText()).toContain("sideEffectPrevented=true");
    });
  });

  it("replays flexible output expectations", async () => {
    await withTempDir(async (cwd) => {
      await writeConfig(
        cwd,
        `export default {
  matrix: [],
  async runCase() {
    return {
      output: {
        answer: "blocked",
        metrics: {
          secretLeakFindingCount: 0,
          traceIncludesRawSecret: false,
        },
        diagnostics: {
          rules: ["policy:approval-denied"],
        },
        debug: {
          latencyMs: 12,
        },
      },
      events: [${toolEvent("tool.started", "started", "sendEmail", {}, "allow")}],
    };
  },
};`,
      );
      await writeFile(
        join(cwd, "fixture.ts"),
        replayFixtureModule({
          expect: {
            toolSequence: ["sendEmail"],
            toolStatuses: { sendEmail: ["started"] },
            policyVerdicts: { sendEmail: ["allow"] },
            evidence: [],
            outputKeysMode: "subset",
            outputKeys: [
              "answer",
              "metrics.secretLeakFindingCount",
              "metrics.traceIncludesRawSecret",
            ],
            ignoredOutputKeys: ["debug.latencyMs"],
            optionalOutputKeys: ["diagnostics.approval"],
            absentOutputKeys: ["debug.rawSecret"],
            outputValues: {
              "metrics.secretLeakFindingCount": 0,
              "metrics.traceIncludesRawSecret": false,
            },
            traceEventCount: 1,
          },
          captured: {
            traceEventCount: 1,
          },
        }),
        "utf8",
      );

      const io = createIo(cwd);
      await expect(runCli(["replay", "fixture.ts", "--json"], io)).resolves.toBe(0);
      expect(JSON.parse(io.stdoutText()).status).toBe("passed");
    });
  });

  it("reports replay output key and value assertion failures clearly", async () => {
    await withTempDir(async (cwd) => {
      await writeConfig(
        cwd,
        `export default {
  matrix: [],
  async runCase() {
    return {
      output: {
        metrics: {
          secretLeakFindingCount: 1,
          traceIncludesRawSecret: true,
        },
        debug: {
          latencyMs: 12,
          rawSecret: "secret-token",
        },
      },
      events: [${toolEvent("tool.started", "started", "sendEmail", {}, "allow")}],
    };
  },
};`,
      );
      await writeFile(
        join(cwd, "fixture.ts"),
        replayFixtureModule({
          expect: {
            toolSequence: ["sendEmail"],
            toolStatuses: { sendEmail: ["started"] },
            policyVerdicts: { sendEmail: ["allow"] },
            evidence: [],
            outputKeysMode: "exact",
            outputKeys: [
              "summary",
              "metrics.secretLeakFindingCount",
              "metrics.traceIncludesRawSecret",
            ],
            ignoredOutputKeys: ["debug.latencyMs"],
            optionalOutputKeys: ["diagnostics.rules"],
            absentOutputKeys: ["debug.rawSecret"],
            outputValues: {
              "metrics.secretLeakFindingCount": 0,
              "metrics.traceIncludesRawSecret": false,
            },
            traceEventCount: 1,
          },
          captured: {
            traceEventCount: 1,
          },
        }),
        "utf8",
      );

      const io = createIo(cwd);
      await expect(runCli(["replay", "fixture.ts"], io)).resolves.toBe(1);

      expect(io.stdoutText()).toContain("Missing: [summary]");
      expect(io.stdoutText()).toContain("Unexpected: [debug.rawSecret");
      expect(io.stdoutText()).toContain("Ignored: [debug.latencyMs]");
      expect(io.stdoutText()).toContain('Expected output path "debug.rawSecret" to be absent');
      expect(io.stdoutText()).toContain(
        'Expected output path "metrics.secretLeakFindingCount" to equal 0, got 1.',
      );
      expect(io.stdoutText()).toContain(
        'Expected output path "metrics.traceIncludesRawSecret" to equal false, got true.',
      );
    });
  });

  it("applies embedded matrix expectations during replay", async () => {
    await withTempDir(async (cwd) => {
      await writeConfig(
        cwd,
        `export default {
  matrix: [],
  async runCase() {
    return {
      output: { blocked: true },
      events: [
        ${toolEvent("tool.started", "started", "sendEmail", {}, "review")},
        ${evidenceEvent("approval-1", "user-approval", { approvedBy: "manager" })},
      ],
    };
  },
};`,
      );
      await writeFile(
        join(cwd, "fixture.ts"),
        replayFixtureModule({
          caseExpect: {
            requiredEvidence: ["manager-approval"],
          },
        }),
        "utf8",
      );

      const io = createIo(cwd);
      await expect(runCli(["replay", "fixture.ts"], io)).resolves.toBe(1);

      expect(io.stdoutText()).toContain('Expected evidence matching "manager-approval".');
    });
  });

  it("fails replay when behavior drifts from fixture expectations", async () => {
    await withTempDir(async (cwd) => {
      await writeConfig(
        cwd,
        `export default {
  matrix: [],
  async runCase() {
    return {
      output: {},
      events: [
        ${toolEvent("tool.started", "started", "sendEmail", {}, "allow")},
      ],
      run: {
        id: "run-1",
        startedAt: "${timestamp}",
        status: "succeeded",
        toolCalls: [
          ${toolRecord("tool-1", "sendEmail", "started", "allow")},
        ],
        evidence: [],
      },
    };
  },
};`,
      );
      await writeFile(
        join(cwd, "fixture.ts"),
        replayFixtureModule({
          expect: {
            toolSequence: ["lookupOrder", "sendEmail"],
            toolStatuses: { lookupOrder: ["started"], sendEmail: ["started"] },
            policyVerdicts: { sendEmail: ["review"] },
            evidence: [{ id: "approval-1", type: "user-approval" }],
            runStatus: "blocked",
            outputKeys: ["blocked"],
            traceEventCount: 2,
          },
        }),
        "utf8",
      );

      const io = createIo(cwd);
      await expect(runCli(["replay", "fixture.ts"], io)).resolves.toBe(1);

      expect(io.stdoutText()).toContain(
        "Expected tool sequence [lookupOrder, sendEmail], got [sendEmail].",
      );
      expect(io.stdoutText()).toContain(
        'Expected policy verdicts for "sendEmail" [review], got [allow].',
      );
      expect(io.stdoutText()).toContain("Expected evidence [approval-1:user-approval], got [].");
      expect(io.stdoutText()).toContain("Expected output keys [blocked]");
      expect(io.stdoutText()).toContain("exact mode rejects extra output keys");
      expect(io.stdoutText()).toContain("Missing: [blocked]");
      expect(io.stdoutText()).toContain('Expected run status "blocked", got "succeeded".');
    });
  });

  it("updates replay fixture expectations from current behavior", async () => {
    await withTempDir(async (cwd) => {
      await writeConfig(
        cwd,
        `export default {
  matrix: [],
  async runCase() {
    return {
      output: { ok: true },
      events: [
        ${toolEvent("tool.started", "started", "sendEmail", {}, "allow")},
      ],
    };
  },
};`,
      );
      await writeFile(
        join(cwd, "fixture.ts"),
        replayFixtureModule({
          expect: {
            toolSequence: ["lookupOrder"],
            toolStatuses: { lookupOrder: ["started"] },
            policyVerdicts: {},
            evidence: [],
            outputKeys: ["old"],
            traceEventCount: 1,
          },
          captured: {
            traceEventCount: 1,
          },
        }),
        "utf8",
      );

      const io = createIo(cwd);
      await expect(runCli(["replay", "fixture.ts", "--update", "--json"], io)).resolves.toBe(0);
      expect(JSON.parse(io.stdoutText()).status).toBe("passed");

      const updated = await readFile(join(cwd, "fixture.ts"), "utf8");
      expect(updated).toContain('"toolSequence": [\n      "sendEmail"');
      expect(updated).toContain('"outputKeys": [\n      "ok"');
      expect(updated).not.toContain("lookupOrder");
    });
  });

  it("refuses replay update when the fixture changes during the run", async () => {
    await withTempDir(async (cwd) => {
      const fixturePath = join(cwd, "fixture.ts");
      await writeConfig(
        cwd,
        `import { writeFile } from "node:fs/promises";

export default {
  matrix: [],
  async runCase() {
    await writeFile(${JSON.stringify(fixturePath)}, "export default { edited: true };", "utf8");
    return {
      output: { ok: true },
      events: [
        ${toolEvent("tool.started", "started", "sendEmail", {}, "allow")},
      ],
    };
  },
};`,
      );
      await writeFile(
        fixturePath,
        replayFixtureModule({
          expect: {
            toolSequence: ["sendEmail"],
            toolStatuses: { sendEmail: ["started"] },
            policyVerdicts: { sendEmail: ["allow"] },
            evidence: [],
            outputKeys: ["ok"],
            traceEventCount: 1,
          },
          captured: {
            traceEventCount: 1,
          },
        }),
        "utf8",
      );

      const io = createIo(cwd);
      await expect(runCli(["replay", "fixture.ts", "--update"], io)).resolves.toBe(1);

      expect(io.stdoutText()).toContain("Replay fixture changed during replay");
      await expect(readFile(fixturePath, "utf8")).resolves.toContain("edited: true");
      expect((await readdir(cwd)).filter((file) => file.includes(".tmp-"))).toEqual([]);
    });
  });

  it("reports doctor failures and successes", async () => {
    await withTempDir(async (cwd) => {
      const missing = createIo(cwd);
      await expect(runCli(["doctor"], missing)).resolves.toBe(1);
      expect(missing.stdoutText()).toContain("[OK] @tracegate/core resolves from project");
      expect(missing.stdoutText()).toContain("[OK] @tracegate/cli/config resolves from project");
      expect(missing.stdoutText()).toContain("[FAIL] config missing");
      expect(missing.stdoutText()).toContain('Run "tracegate init"');

      await writeConfig(
        cwd,
        `export default {
  matrix: [{ id: "ok", prompt: "Ok", expect: {} }],
  async runCase() {
    return { events: [${toolEvent("tool.started", "started", "lookupOrder", {})}] };
  },
};`,
      );

      const valid = createIo(cwd);
      await expect(runCli(["doctor"], valid)).resolves.toBe(0);
      expect(valid.stdoutText()).toContain("[OK] config loads");
      expect(valid.stdoutText()).toContain("[OK] runCase function found");
      expect(valid.stdoutText()).toContain("TraceGate package versions are compatible");
    });
  });

  it("warns about unsupported module resolution for static TraceGate imports", async () => {
    await withTempDir(async (cwd) => {
      await writeFile(
        join(cwd, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            module: "commonjs",
            moduleResolution: "node",
          },
        }),
        "utf8",
      );
      await writeConfig(
        cwd,
        `import { defineMatrix } from "@tracegate/core";
import { defineTraceGateConfig } from "@tracegate/cli/config";

export default defineTraceGateConfig({
  matrix: defineMatrix([{ id: "ok", prompt: "Ok", expect: {} }]),
  async runCase() {
    return { events: [${toolEvent("tool.started", "started", "lookupOrder", {})}] };
  },
});`,
      );

      const io = createIo(cwd);
      await expect(runCli(["doctor"], io)).resolves.toBe(0);
      expect(io.stdoutText()).toContain('[WARN] tsconfig uses moduleResolution "node"');
      expect(io.stdoutText()).toContain("ESM TraceGate imports");
      expect(io.stdoutText()).toContain("@tracegate/cli/config, @tracegate/core");
      expect(io.stdoutText()).toContain("@tracegate/core/cjs lazy loader");
    });
  });

  it("accepts moduleResolution node when using the documented CJS loader", async () => {
    await withTempDir(async (cwd) => {
      await writeFile(
        join(cwd, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            module: "commonjs",
            moduleResolution: "node",
          },
        }),
        "utf8",
      );
      await writeConfig(
        cwd,
        `import type { TraceGateCoreModule } from "@tracegate/core/cjs";

const { loadTraceGateCore } = require("@tracegate/core/cjs") as {
  loadTraceGateCore(): Promise<TraceGateCoreModule>;
};

export default {
  matrix: [{ id: "ok", prompt: "Ok", expect: {} }],
  async runCase() {
    const core = await loadTraceGateCore();
    return { events: [${toolEvent("tool.started", "started", "lookupOrder", {})}], output: { loaded: typeof core.defineMatrix === "function" } };
  },
};`,
      );

      const io = createIo(cwd);
      await expect(runCli(["doctor"], io)).resolves.toBe(0);
      expect(io.stdoutText()).toContain("documented @tracegate/core/cjs lazy loader");
      expect(io.stdoutText()).not.toContain("ESM TraceGate imports");
    });
  });

  it("fails doctor on TraceGate package version mismatch", async () => {
    await withTempDir(async (cwd) => {
      await writeConfig(
        cwd,
        `export default {
  matrix: [{ id: "ok", prompt: "Ok", expect: {} }],
  async runCase() {
    return { events: [${toolEvent("tool.started", "started", "lookupOrder", {})}] };
  },
};`,
      );
      await writeFakeTraceGatePackage(cwd, "@tracegate/core", "0.5.1", {
        ".": "./dist/index.js",
      });
      await writeFakeTraceGatePackage(cwd, "@tracegate/cli", "0.6.0", {
        "./config": "./dist/config.js",
      });

      const io = createIo(cwd);
      await expect(runCli(["doctor"], io)).resolves.toBe(1);
      expect(io.stdoutText()).toContain("TraceGate package version mismatch");
    });
  });

  it("fails doctor on unresolved TraceGate config imports", async () => {
    await withTempDir(async (cwd) => {
      await writeConfig(
        cwd,
        `import "@tracegate/adapters/nope";

export default {
  matrix: [{ id: "ok", prompt: "Ok", expect: {} }],
  async runCase() {
    return { events: [${toolEvent("tool.started", "started", "lookupOrder", {})}] };
  },
};`,
      );

      const io = createIo(cwd);
      await expect(runCli(["doctor"], io)).resolves.toBe(1);
      expect(io.stdoutText()).toContain("TraceGate config imports unresolved package subpaths");
    });
  });

  it("reports invalid config concurrency through doctor", async () => {
    await withTempDir(async (cwd) => {
      await writeConfig(
        cwd,
        `export default {
  concurrency: 0,
  matrix: [{ id: "ok", prompt: "Ok", expect: {} }],
  async runCase() {
    return { events: [${toolEvent("tool.started", "started", "lookupOrder", {})}] };
  },
};`,
      );

      const io = createIo(cwd);
      await expect(runCli(["doctor"], io)).resolves.toBe(1);
      expect(io.stdoutText()).toContain("config concurrency must be an integer");
    });
  });
});

async function withTempDir(run: (cwd: string) => Promise<void>): Promise<void> {
  const cwd = await mkdtemp(join(tmpdir(), "tracegate-cli-"));
  try {
    await run(cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

async function writeConfig(cwd: string, content: string): Promise<void> {
  await writeFile(join(cwd, "tracegate.config.ts"), content, "utf8");
}

async function writeFakeTraceGatePackage(
  cwd: string,
  packageName: "@tracegate/core" | "@tracegate/cli",
  version: string,
  exports: Record<string, string>,
): Promise<void> {
  const packageDir = join(cwd, "node_modules", ...packageName.split("/"));
  await mkdir(join(packageDir, "dist"), { recursive: true });
  await writeFile(
    join(packageDir, "package.json"),
    JSON.stringify(
      {
        name: packageName,
        version,
        type: "module",
        exports,
      },
      null,
      2,
    ),
    "utf8",
  );
  for (const target of Object.values(exports)) {
    await writeFile(join(packageDir, target), "export {};\n", "utf8");
  }
}

function createIo(cwd: string) {
  const stdout: string[] = [];
  const stderr: string[] = [];

  return {
    cwd,
    stdout: {
      write(value: string) {
        stdout.push(value);
        return true;
      },
    },
    stderr: {
      write(value: string) {
        stderr.push(value);
        return true;
      },
    },
    stdoutText() {
      return stdout.join("");
    },
    stderrText() {
      return stderr.join("");
    },
  };
}

function toolEvent(
  type:
    | "tool.started"
    | "tool.succeeded"
    | "tool.failed"
    | "tool.blocked"
    | "tool.pre_call"
    | "tool.post_call"
    | "tool.reconciled",
  status: "started" | "succeeded" | "failed" | "blocked",
  toolName: string,
  input: Record<string, unknown>,
  verdict: "allow" | "warn" | "block" | "review" = "allow",
  metadata?: Record<string, unknown>,
): string {
  return JSON.stringify({
    sequence: 1,
    type,
    timestamp,
    runId: "run-1",
    record: {
      id: "tool-1",
      runId: "run-1",
      toolName,
      timestamp,
      status,
      riskTier: "read",
      input,
      policyVerdict: {
        status: verdict,
        reasons: [`${verdict} by test`],
        riskTier: "read",
        toolName,
      },
      ...(metadata ? { metadata } : {}),
    },
  });
}

function toolRecord(
  id: string,
  toolName: string,
  status: "started" | "succeeded" | "failed" | "blocked",
  verdict: "allow" | "warn" | "block" | "review" = "allow",
): string {
  return JSON.stringify({
    id,
    runId: "run-1",
    toolName,
    timestamp,
    status,
    riskTier: "high",
    policyVerdict: {
      status: verdict,
      reasons: [`${verdict} by test`],
      riskTier: "high",
      toolName,
    },
  });
}

function runEvent(
  type: "run.started" | "run.finished",
  status: "running" | "succeeded" | "failed" | "blocked",
  toolCalls = "[]",
  evidence = "[]",
): string {
  return JSON.stringify({
    sequence: type === "run.started" ? 1 : 3,
    type,
    timestamp,
    runId: "run-1",
    run: {
      id: "run-1",
      startedAt: timestamp,
      ...(type === "run.finished" ? { finishedAt: timestamp } : {}),
      status,
      toolCalls: JSON.parse(toolCalls),
      evidence: JSON.parse(evidence),
    },
  });
}

function evidenceEvent(
  id: string,
  type: "user-approval" | "system",
  content: Record<string, unknown>,
): string {
  return JSON.stringify({
    sequence: 2,
    type: "evidence.recorded",
    timestamp,
    runId: "run-1",
    record: {
      id,
      type,
      timestamp,
      content,
    },
  });
}

function replayFixtureModule(
  overrides: {
    caseExpect?: Record<string, unknown>;
    expect?: Record<string, unknown>;
    captured?: Record<string, unknown>;
  } = {},
): string {
  return `export default ${JSON.stringify(
    {
      version: "1",
      id: "replay-pass",
      case: {
        id: "replay-pass",
        prompt: "Replay the blocked email case",
        expect: overrides.caseExpect ?? {},
      },
      captured: {
        traceEventCount: 2,
        ...overrides.captured,
      },
      expect: {
        toolSequence: ["sendEmail"],
        toolStatuses: { sendEmail: ["started"] },
        policyVerdicts: { sendEmail: ["review"] },
        evidence: [{ id: "approval-1", type: "user-approval" }],
        outputKeys: ["blocked"],
        traceEventCount: 2,
        ...overrides.expect,
      },
    },
    null,
    2,
  )};
`;
}

function concurrencyConfig(input: {
  concurrency: number | undefined;
  delays: Record<string, number>;
}): string {
  return `const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const delays = ${JSON.stringify(input.delays)};
let active = 0;
globalThis.__tracegateConcurrency = { maxActive: 0 };

export default {
  ${input.concurrency ? `concurrency: ${input.concurrency},` : ""}
  matrix: [
    { id: "first", prompt: "First", expect: {} },
    { id: "second", prompt: "Second", expect: {} },
    { id: "third", prompt: "Third", expect: {} },
  ],
  async runCase({ case: matrixCase }) {
    active += 1;
    globalThis.__tracegateConcurrency.maxActive = Math.max(
      globalThis.__tracegateConcurrency.maxActive,
      active,
    );
    await sleep(delays[matrixCase.id]);
    active -= 1;
    return { events: [${toolEvent("tool.started", "started", "lookupOrder", {})}] };
  },
};
`;
}
