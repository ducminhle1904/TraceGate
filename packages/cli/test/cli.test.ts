import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../src/cli.js";

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
      await expect(runCli(["init"], createIo(cwd))).resolves.toBe(1);
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

  it("reports doctor failures and successes", async () => {
    await withTempDir(async (cwd) => {
      const missing = createIo(cwd);
      await expect(runCli(["doctor"], missing)).resolves.toBe(1);
      expect(missing.stdoutText()).toContain("[FAIL] config exists");

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
  type: "tool.started" | "tool.succeeded" | "tool.failed" | "tool.blocked",
  status: "started" | "succeeded" | "failed" | "blocked",
  toolName: string,
  input: Record<string, unknown>,
  verdict: "allow" | "warn" | "block" | "review" = "allow",
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
