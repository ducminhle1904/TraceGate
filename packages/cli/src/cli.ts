import { access, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import type { MatrixCase } from "@tracegate/core";

import { evaluateMatrixAssertions } from "./assertions.js";
import type { TraceGateConfig, TraceGateRunnerResult } from "./config.js";
import { DEFAULT_CONFIG_FILE, loadTraceGateConfig } from "./config-loader.js";
import { formatRunCaseError, getErrorMessage, isNodeError } from "./errors.js";
import { runFixturesCommand, runReplayCommand, runReplayRuntimeCommand } from "./replay-command.js";
import {
  createMatrixReport,
  formatConsoleReport,
  type MatrixCaseResult,
  summarizeOutput,
  writeJunitReport,
} from "./report.js";

export interface CliIo {
  cwd: string;
  stdout: Pick<NodeJS.WritableStream, "write">;
  stderr: Pick<NodeJS.WritableStream, "write">;
  now?: () => Date;
}

type WriteableStream = Pick<NodeJS.WritableStream, "write">;

export async function runCli(argv: string[], io: CliIo): Promise<number> {
  const [command = "test", ...args] = argv;

  try {
    switch (command) {
      case "init":
        return await runInit(args, io);
      case "test":
        return await runTest(args, io);
      case "doctor":
        return await runDoctor(args, io);
      case "fixtures":
        return await runFixturesCommand(args, io);
      case "replay":
        return await runReplayCommand(args, io);
      case "replay-runtime":
        return await runReplayRuntimeCommand(args, io);
      case "--help":
      case "-h":
      case "help":
        write(io.stdout, helpText());
        return 0;
      default:
        write(io.stderr, `Unknown command "${command}".\n\n${helpText()}`);
        return 1;
    }
  } catch (error) {
    write(io.stderr, `${getErrorMessage(error)}\n`);
    return 1;
  }
}

async function runInit(args: string[], io: CliIo): Promise<number> {
  const { values } = parseArgs({
    args,
    allowPositionals: false,
    options: {
      config: { type: "string", short: "c" },
    },
  });
  const configValue = readOptionalString(values.config, "--config");
  const configPath = resolve(io.cwd, configValue ?? DEFAULT_CONFIG_FILE);

  try {
    await writeFile(configPath, starterConfig(), { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") {
      write(io.stderr, `TraceGate config already exists: ${configPath}\n`);
      return 1;
    }
    throw error;
  }
  write(io.stdout, `Created ${configPath}\n`);
  return 0;
}

async function runTest(args: string[], io: CliIo): Promise<number> {
  const { values } = parseArgs({
    args,
    allowPositionals: false,
    options: {
      case: { type: "string" },
      config: { type: "string", short: "c" },
      concurrency: { type: "string" },
      json: { type: "boolean" },
      junit: { type: "string" },
      policy: { type: "boolean" },
    },
  });
  const caseId = readOptionalString(values.case, "--case");
  const configPath = readOptionalString(values.config, "--config");
  const cliConcurrency = parseConcurrency(readOptionalString(values.concurrency, "--concurrency"));
  const junitPath = readOptionalString(values.junit, "--junit");
  const startedAt = now(io);
  const { config } = await loadTraceGateConfig({
    cwd: io.cwd,
    ...(configPath ? { configPath } : {}),
  });
  const concurrency = cliConcurrency ?? config.concurrency ?? 1;
  const cases = filterCases(config.matrix, {
    policyOnly: values.policy === true,
    ...(caseId ? { caseId } : {}),
  });

  if (caseId && cases.length === 0) {
    write(io.stderr, `No matrix case found with id "${caseId}".\n`);
    return 1;
  }

  const results = await runMatrixCases({ cases, concurrency, config, io });

  const report = createMatrixReport({
    startedAt,
    finishedAt: now(io),
    cases: results,
  });

  if (junitPath) {
    await writeJunitReport(report, resolve(io.cwd, junitPath));
  }

  if (values.json) {
    write(io.stdout, `${JSON.stringify(report, null, 2)}\n`);
  } else {
    write(io.stdout, formatConsoleReport(report));
  }

  return report.status === "passed" ? 0 : 1;
}

async function runDoctor(args: string[], io: CliIo): Promise<number> {
  const { values } = parseArgs({
    args,
    allowPositionals: false,
    options: {
      config: { type: "string", short: "c" },
    },
  });
  const configValue = readOptionalString(values.config, "--config");
  const checks: Array<{ ok: boolean; message: string }> = [];
  const configPath = resolve(io.cwd, configValue ?? DEFAULT_CONFIG_FILE);

  checks.push(checkProjectPackageResolution(io.cwd, "@tracegate/core"));
  checks.push(checkProjectPackageResolution(io.cwd, "@tracegate/cli/config"));

  const configExists = await exists(configPath);
  checks.push({
    ok: configExists,
    message: configExists
      ? `config exists: ${configPath}`
      : `config missing: ${configPath}. Run "tracegate init" or pass --config <path>.`,
  });

  try {
    const loaded = await loadTraceGateConfig({
      cwd: io.cwd,
      ...(configValue ? { configPath: configValue } : {}),
    });
    checks.push({ ok: true, message: `config loads: ${loaded.path}` });
    checks.push({ ok: true, message: `matrix cases: ${loaded.config.matrix.length}` });
    checks.push({ ok: true, message: "runCase function found" });
  } catch (error) {
    checks.push({
      ok: false,
      message: `config check failed: ${getErrorMessage(error)}`,
    });
  }

  for (const check of checks) {
    write(io.stdout, `[${check.ok ? "OK" : "FAIL"}] ${check.message}\n`);
  }

  return checks.every((check) => check.ok) ? 0 : 1;
}

function checkProjectPackageResolution(
  cwd: string,
  specifier: string,
): { ok: boolean; message: string } {
  try {
    const requireFromProject = createRequire(resolve(cwd, "package.json"));
    requireFromProject.resolve(specifier);
    return { ok: true, message: `${specifier} resolves from project` };
  } catch (error) {
    return {
      ok: false,
      message: `${specifier} does not resolve from this project: ${getErrorMessage(error)}. Install TraceGate packages in this project and rerun pnpm install.`,
    };
  }
}

function filterCases(
  cases: readonly MatrixCase[],
  filters: { caseId?: string; policyOnly: boolean },
): MatrixCase[] {
  return cases.filter((matrixCase) => {
    if (filters.caseId && matrixCase.id !== filters.caseId) {
      return false;
    }
    if (filters.policyOnly && !isPolicyCase(matrixCase)) {
      return false;
    }
    return true;
  });
}

function isPolicyCase(matrixCase: MatrixCase): boolean {
  const expectations = matrixCase.expect;
  return Boolean(
    expectations.requiredPolicyVerdict ||
      expectations.forbiddenTools?.length ||
      expectations.requiredEvidence?.length ||
      expectations.redactionChecks?.length,
  );
}

function readOptionalString(value: string | undefined, name: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value.length === 0) {
    throw new Error(`${name} must not be empty.`);
  }

  return value;
}

function parseConcurrency(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error("--concurrency must be an integer greater than or equal to 1.");
  }

  return parsed;
}

async function runMatrixCases(input: {
  cases: MatrixCase[];
  concurrency: number;
  config: TraceGateConfig;
  io: CliIo;
}): Promise<MatrixCaseResult[]> {
  const results = new Array<MatrixCaseResult>(input.cases.length);
  let cursor = 0;
  const workerCount = Math.min(input.concurrency, input.cases.length);

  const runNext = async (): Promise<void> => {
    while (true) {
      const index = cursor;
      cursor += 1;
      const matrixCase = input.cases[index];
      if (!matrixCase) {
        return;
      }
      results[index] = await runMatrixCase(input.config, matrixCase, index, input.io);
    }
  };

  await Promise.all(Array.from({ length: workerCount }, runNext));
  return results;
}

async function runMatrixCase(
  config: TraceGateConfig,
  matrixCase: MatrixCase,
  index: number,
  io: CliIo,
): Promise<MatrixCaseResult> {
  const caseStartedAt = now(io);
  const failures: string[] = [];
  let result: TraceGateRunnerResult | undefined;
  let runId: string | undefined;
  let traceEventCount = 0;

  try {
    result = await config.runCase({ case: matrixCase, index });
    if (!result || (!result.events && !result.run)) {
      failures.push("runCase must return at least events or run.");
    } else {
      const assertionResult = evaluateMatrixAssertions({ case: matrixCase, result });
      failures.push(...assertionResult.failures);
      runId = assertionResult.runId;
      traceEventCount = assertionResult.traceEventCount;
    }
  } catch (error) {
    failures.push(`runCase threw: ${formatRunCaseError(error)}`);
  }

  const outputSummary = summarizeOutput(result?.output);
  return {
    id: matrixCase.id,
    status: failures.length > 0 ? "failed" : "passed",
    durationMs: now(io).getTime() - caseStartedAt.getTime(),
    failures,
    traceEventCount,
    ...(outputSummary ? { outputSummary } : {}),
    ...(runId ? { runId } : {}),
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function write(stream: WriteableStream, value: string): void {
  stream.write(value);
}

function now(io: CliIo): Date {
  return io.now?.() ?? new Date();
}

function helpText(): string {
  return [
    "TraceGate CLI",
    "",
    "Commands:",
    "  tracegate init [--config tracegate.config.ts]",
    "  tracegate test [--case id] [--policy] [--concurrency n] [--json] [--junit path] [--config path]",
    "  tracegate fixtures create <trace.jsonl> --out <fixture.ts> [--runtime-gate] [--case id] [--config path] [--force]",
    "  tracegate replay <fixture.ts> [--config path] [--json] [--junit path] [--update]",
    "  tracegate replay-runtime <fixture.ts> --trace <trace.jsonl> [--json] [--junit path]",
    "  tracegate doctor [--config path]",
    "",
  ].join("\n");
}

function starterConfig(): string {
  return `import { defineMatrix } from "@tracegate/core";
import { defineTraceGateConfig } from "@tracegate/cli/config";

export default defineTraceGateConfig({
  matrix: defineMatrix([
    {
      id: "example-case",
      prompt: "Exercise one agent behavior.",
      expect: {
        requiredTools: ["lookupOrder"],
      },
    },
  ]),
  async runCase({ case: matrixCase }) {
    throw new Error(\`Connect your agent runner for case "\${matrixCase.id}".\`);
  },
});
`;
}
