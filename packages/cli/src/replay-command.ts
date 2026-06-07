import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  compareReplayExpectation,
  createReplayExpectation,
  defineReplayFixture,
  parseTraceJsonlStream,
  type ReplayFixture,
  ReplayFixtureSchema,
  summarizeReplaySource,
} from "@tracegate/core";

import { evaluateMatrixAssertions } from "./assertions.js";
import { loadTraceGateConfig, loadTypeScriptModule, unwrapDefault } from "./config-loader.js";
import {
  createMatrixReport,
  formatConsoleReport,
  type MatrixCaseResult,
  summarizeOutput,
  writeJunitReport,
} from "./report.js";

interface CommandIo {
  cwd: string;
  stdout: Pick<NodeJS.WritableStream, "write">;
  stderr: Pick<NodeJS.WritableStream, "write">;
  now?: () => Date;
}

export async function runFixturesCommand(args: string[], io: CommandIo): Promise<number> {
  const [subcommand, ...rest] = args;
  if (subcommand !== "create") {
    write(io.stderr, 'Unknown fixtures command. Use "tracegate fixtures create <trace.jsonl>".\n');
    return 1;
  }

  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      case: { type: "string" },
      config: { type: "string", short: "c" },
      force: { type: "boolean" },
      out: { type: "string" },
    },
  });
  const tracePath = readRequiredPositional(positionals[0], "trace JSONL path");
  const outPath = readRequiredString(values.out, "--out");
  const caseId = readOptionalString(values.case, "--case");
  const configPath = readOptionalString(values.config, "--config");
  const traceFilePath = resolve(io.cwd, tracePath);
  const outputPath = resolve(io.cwd, outPath);
  const events = await parseTraceJsonlStream(createReadStream(traceFilePath));
  const matrixCase = caseId
    ? await loadCaseFromConfig(io.cwd, configPath, caseId)
    : {
        id: toFixtureId(traceFilePath),
        prompt: `Replay trace ${basename(traceFilePath)}`,
        expect: {},
      };
  const fixture = defineReplayFixture({
    version: "1",
    id: matrixCase.id,
    case: matrixCase,
    captured: summarizeReplaySource({ events }),
    expect: createReplayExpectation({ events }),
    metadata: {
      source: tracePath,
    },
  });

  try {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, formatFixtureModule(fixture), {
      encoding: "utf8",
      flag: values.force ? "w" : "wx",
    });
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") {
      write(io.stderr, `Replay fixture already exists: ${outputPath}\n`);
      return 1;
    }
    throw error;
  }

  write(io.stdout, `Created ${outputPath}\n`);
  return 0;
}

export async function runReplayCommand(args: string[], io: CommandIo): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      config: { type: "string", short: "c" },
      json: { type: "boolean" },
      junit: { type: "string" },
      update: { type: "boolean" },
    },
  });
  const fixturePath = readRequiredPositional(positionals[0], "replay fixture path");
  const configPath = readOptionalString(values.config, "--config");
  const junitPath = readOptionalString(values.junit, "--junit");
  const fixtureFilePath = resolve(io.cwd, fixturePath);
  const fixtureFingerprint = values.update ? await readFileFingerprint(fixtureFilePath) : undefined;
  const fixture = await loadReplayFixture(fixtureFilePath);
  if (fixtureFingerprint) {
    await assertFileUnchanged(
      fixtureFilePath,
      fixtureFingerprint,
      "Replay fixture changed while loading.",
    );
  }
  const startedAt = now(io);
  const caseStartedAt = now(io);
  const { config } = await loadTraceGateConfig({
    cwd: io.cwd,
    ...(configPath ? { configPath } : {}),
  });
  const failures: string[] = [];
  let runId: string | undefined;
  let traceEventCount = 0;
  let outputSummary: string | undefined;
  let result: Awaited<ReturnType<(typeof config)["runCase"]>> | undefined;
  let failureContext: "runCase" | "replay comparison" | "replay update" = "runCase";

  try {
    result = await config.runCase({ case: fixture.case, index: 0 });
    if (!result || (!result.events && !result.run)) {
      failures.push("runCase must return at least events or run.");
    } else {
      failureContext = "replay comparison";
      const assertionResult = evaluateMatrixAssertions({ case: fixture.case, result });
      const comparison = compareReplayExpectation(fixture.expect, result);
      failures.push(...assertionResult.failures);
      runId = assertionResult.runId;
      traceEventCount = assertionResult.traceEventCount;
      outputSummary = summarizeOutput(result.output);

      if (values.update && assertionResult.failures.length === 0) {
        failureContext = "replay update";
        const updatedExpectation =
          result.events === undefined
            ? { ...comparison.actual, traceEventCount: fixture.expect.traceEventCount }
            : comparison.actual;
        const updated = defineReplayFixture({
          ...fixture,
          captured:
            result.events === undefined
              ? {
                  ...summarizeReplaySource(result),
                  traceEventCount: fixture.captured.traceEventCount,
                }
              : summarizeReplaySource(result),
          expect: updatedExpectation,
        });
        await writeFixtureAtomically(
          fixtureFilePath,
          formatFixtureModule(updated),
          fixtureFingerprint,
        );
      } else {
        failures.push(...comparison.failures);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(
      failureContext === "runCase"
        ? `runCase threw: ${message}`
        : `${failureContext} failed: ${message}`,
    );
  }

  const caseResult: MatrixCaseResult = {
    id: fixture.id,
    status: failures.length > 0 ? "failed" : "passed",
    durationMs: now(io).getTime() - caseStartedAt.getTime(),
    failures,
    traceEventCount,
    ...(outputSummary ? { outputSummary } : {}),
    ...(runId ? { runId } : {}),
  };
  const report = createMatrixReport({
    startedAt,
    finishedAt: now(io),
    cases: [caseResult],
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

async function loadCaseFromConfig(cwd: string, configPath: string | undefined, caseId: string) {
  const { config } = await loadTraceGateConfig({
    cwd,
    ...(configPath ? { configPath } : {}),
  });
  const matrixCase = config.matrix.find((candidate) => candidate.id === caseId);
  if (!matrixCase) {
    throw new Error(`No matrix case found with id "${caseId}".`);
  }
  return matrixCase;
}

async function loadReplayFixture(path: string): Promise<ReplayFixture> {
  const loaded = await loadTypeScriptModule(path);
  return ReplayFixtureSchema.parse(unwrapDefault(loaded));
}

function formatFixtureModule(fixture: ReplayFixture): string {
  return `import { defineReplayFixture } from "@tracegate/core";

export default defineReplayFixture(${JSON.stringify(fixture, null, 2)});
`;
}

async function writeFixtureAtomically(
  filePath: string,
  content: string,
  expectedFingerprint: string | undefined,
): Promise<void> {
  if (expectedFingerprint) {
    await assertFileUnchanged(
      filePath,
      expectedFingerprint,
      "Replay fixture changed during replay; refusing to overwrite.",
    );
  }

  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(tempPath, content, { encoding: "utf8", flag: "wx" });
    if (expectedFingerprint) {
      await assertFileUnchanged(
        filePath,
        expectedFingerprint,
        "Replay fixture changed during replay; refusing to overwrite.",
      );
    }
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

async function assertFileUnchanged(
  filePath: string,
  expectedFingerprint: string,
  message: string,
): Promise<void> {
  const currentFingerprint = await readFileFingerprint(filePath);
  if (currentFingerprint !== expectedFingerprint) {
    throw new Error(message);
  }
}

async function readFileFingerprint(filePath: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}

function toFixtureId(filePath: string): string {
  return basename(filePath)
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function readRequiredPositional(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`Missing ${name}.`);
  }
  return value;
}

function readRequiredString(value: string | undefined, name: string): string {
  if (value === undefined) {
    throw new Error(`${name} is required.`);
  }
  return readOptionalString(value, name) ?? value;
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

function write(stream: Pick<NodeJS.WritableStream, "write">, value: string): void {
  stream.write(value);
}

function now(io: CommandIo): Date {
  return io.now?.() ?? new Date();
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
