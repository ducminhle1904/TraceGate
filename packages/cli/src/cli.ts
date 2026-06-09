import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, parse, resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  createLooseManifestContractAdapter,
  createReplayExpectation,
  defineToolContract,
  type MatrixCase,
  summarizeReplaySource,
  type ToolTraceEvent,
  ToolTraceEventSchema,
  type TraceGateInputSchema,
} from "@tracegate/core";

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
type DoctorSeverity = "OK" | "WARN" | "FAIL";
interface DoctorCheck {
  severity: DoctorSeverity;
  message: string;
}

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
      force: { type: "boolean" },
    },
  });
  const configValue = readOptionalString(values.config, "--config");
  const configPath = resolve(io.cwd, configValue ?? DEFAULT_CONFIG_FILE);
  const force = values.force === true;
  const files = starterFiles(io.cwd, configPath);

  if (!force) {
    const existing = [];
    for (const file of files) {
      if (await exists(file.path)) {
        existing.push(file.path);
      }
    }
    if (existing.length > 0) {
      write(io.stderr, `TraceGate starter file already exists: ${existing[0]}\n`);
      write(io.stderr, "Rerun with --force to overwrite generated TraceGate starter files.\n");
      return 1;
    }
  }

  for (const file of files) {
    await mkdir(dirname(file.path), { recursive: true });
    await writeFile(file.path, file.content, { encoding: "utf8", flag: force ? "w" : "wx" });
    write(io.stdout, `Created ${file.path}\n`);
  }

  write(
    io.stdout,
    [
      "",
      "Next commands:",
      "  pnpm exec tracegate doctor",
      "  pnpm exec tracegate test",
      "  pnpm exec tracegate replay-runtime tracegate/fixtures/example-runtime.ts --trace tracegate/traces/example-runtime.jsonl",
      "  pnpm exec tsx tracegate/redaction-check.ts",
      "",
    ].join("\n"),
  );
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
  const checks: DoctorCheck[] = [];
  const configPath = resolve(io.cwd, configValue ?? DEFAULT_CONFIG_FILE);
  const configSource = (await readOptionalFile(configPath)) ?? "";
  const traceGateImports = findTraceGateImports(configSource);

  checks.push(checkProjectPackageResolution(io.cwd, "@tracegate/core"));
  checks.push(checkProjectPackageResolution(io.cwd, "@tracegate/cli/config"));
  checks.push(checkOptionalAdapterResolution(io.cwd, traceGateImports));
  checks.push(await checkPackageVersionCompatibility(io.cwd));
  checks.push(await checkTypeScriptModuleResolution(io.cwd, traceGateImports));
  checks.push(checkTraceGateImportsResolve(io.cwd, traceGateImports));
  checks.push(checkSchemaCompatibility(io.cwd));

  const configExists = await exists(configPath);
  checks.push({
    severity: configExists ? "OK" : "FAIL",
    message: configExists
      ? `config exists: ${configPath}`
      : `config missing: ${configPath}. Run "tracegate init" or pass --config <path>.`,
  });

  try {
    const loaded = await loadTraceGateConfig({
      cwd: io.cwd,
      ...(configValue ? { configPath: configValue } : {}),
    });
    checks.push({ severity: "OK", message: `config loads: ${loaded.path}` });
    checks.push({ severity: "OK", message: `matrix cases: ${loaded.config.matrix.length}` });
    checks.push({ severity: "OK", message: "runCase function found" });
  } catch (error) {
    checks.push({
      severity: "FAIL",
      message: `config check failed: ${getErrorMessage(error)}`,
    });
  }

  for (const check of checks) {
    write(io.stdout, `[${check.severity}] ${check.message}\n`);
  }

  return checks.every((check) => check.severity !== "FAIL") ? 0 : 1;
}

function checkProjectPackageResolution(cwd: string, specifier: string): DoctorCheck {
  try {
    const requireFromProject = createRequire(resolve(cwd, "package.json"));
    requireFromProject.resolve(specifier);
    return { severity: "OK", message: `${specifier} resolves from project` };
  } catch (error) {
    return {
      severity: "FAIL",
      message: `${specifier} does not resolve from this project: ${getErrorMessage(error)}. Install TraceGate packages in this project and rerun pnpm install.`,
    };
  }
}

function checkOptionalAdapterResolution(cwd: string, imports: string[]): DoctorCheck {
  const importsAdapters = imports.some((specifier) => specifier.startsWith("@tracegate/adapters"));
  try {
    const requireFromProject = createRequire(resolve(cwd, "package.json"));
    requireFromProject.resolve("@tracegate/adapters");
    return { severity: "OK", message: "@tracegate/adapters resolves from project" };
  } catch (error) {
    return {
      severity: importsAdapters ? "FAIL" : "WARN",
      message: importsAdapters
        ? `config imports @tracegate/adapters but it does not resolve: ${getErrorMessage(error)}. Install @tracegate/adapters or remove the adapter import.`
        : "@tracegate/adapters is not installed; this is fine unless your config imports adapter subpaths.",
    };
  }
}

async function checkPackageVersionCompatibility(cwd: string): Promise<DoctorCheck> {
  const core = await readResolvedPackage(cwd, "@tracegate/core");
  const cli = await readResolvedPackage(cwd, "@tracegate/cli/config");
  if (!core || !cli) {
    return {
      severity: "FAIL",
      message: "could not read TraceGate package versions from resolved package manifests.",
    };
  }
  if (majorMinor(core.version) !== majorMinor(cli.version)) {
    return {
      severity: "FAIL",
      message: `TraceGate package version mismatch: @tracegate/core ${core.version}, @tracegate/cli ${cli.version}. Install matching TraceGate package versions.`,
    };
  }
  return {
    severity: "OK",
    message: `TraceGate package versions are compatible: core ${core.version}, cli ${cli.version}`,
  };
}

async function checkTypeScriptModuleResolution(
  cwd: string,
  traceGateImports: string[],
): Promise<DoctorCheck> {
  const tsconfigPath = await findNearestFile(cwd, "tsconfig.json");
  if (!tsconfigPath) {
    return {
      severity: "OK",
      message: "no tsconfig.json found; skipping TypeScript moduleResolution check.",
    };
  }

  try {
    const tsconfig = parseJsonWithComments(await readFile(tsconfigPath, "utf8")) as {
      compilerOptions?: { moduleResolution?: string };
    };
    const moduleResolution = tsconfig.compilerOptions?.moduleResolution?.toLowerCase();
    const esmTraceGateImports = traceGateImports.filter(
      (specifier) => specifier !== "@tracegate/core/cjs",
    );
    const usesCjsLoader = traceGateImports.includes("@tracegate/core/cjs");
    if (moduleResolution === "node" && esmTraceGateImports.length > 0) {
      return {
        severity: "WARN",
        message: `tsconfig uses moduleResolution "node" with ESM TraceGate imports (${esmTraceGateImports.join(", ")}). Prefer "node16", "nodenext", or "bundler"; CommonJS apps should use the documented @tracegate/core/cjs lazy loader.`,
      };
    }
    if (moduleResolution === "node" && usesCjsLoader) {
      return {
        severity: "OK",
        message:
          'tsconfig uses moduleResolution "node" with the documented @tracegate/core/cjs lazy loader; this CommonJS pattern is supported.',
      };
    }
    return {
      severity: "OK",
      message: moduleResolution
        ? `tsconfig moduleResolution is ${moduleResolution}`
        : "tsconfig has no moduleResolution override.",
    };
  } catch (error) {
    return {
      severity: "WARN",
      message: `could not inspect ${tsconfigPath}: ${getErrorMessage(error)}`,
    };
  }
}

function checkTraceGateImportsResolve(cwd: string, imports: string[]): DoctorCheck {
  const requireFromProject = createRequire(resolve(cwd, "package.json"));
  const failures = [];
  for (const specifier of imports) {
    try {
      requireFromProject.resolve(specifier);
    } catch (error) {
      failures.push(`${specifier}: ${getErrorMessage(error)}`);
    }
  }
  if (failures.length > 0) {
    return {
      severity: "FAIL",
      message: `TraceGate config imports unresolved package subpaths: ${failures.join("; ")}`,
    };
  }
  return {
    severity: "OK",
    message:
      imports.length > 0
        ? `TraceGate config imports resolve: ${imports.join(", ")}`
        : "TraceGate config has no static TraceGate imports to preflight.",
  };
}

function checkSchemaCompatibility(cwd: string): DoctorCheck {
  try {
    const requireFromProject = createRequire(resolve(cwd, "package.json"));
    let zod: {
      object(shape: Record<string, unknown>): unknown;
      string(): unknown;
    };
    try {
      zod = requireFromProject("zod") as typeof zod;
    } catch {
      return {
        severity: "WARN",
        message:
          "project zod package does not resolve; install zod when your TraceGate config defines Zod tool schemas.",
      };
    }
    const inputSchema = zod.object({ value: zod.string() }) as TraceGateInputSchema;
    defineToolContract({
      name: "doctorSchemaCheck",
      riskTier: "read",
      inputSchema,
    });
    createLooseManifestContractAdapter({
      registry: [{ name: "doctorSchemaCheck", riskTier: "read" }],
      schemas: { doctorSchemaCheck: inputSchema },
      getName: (manifest) => manifest.name,
      getRiskTier: (manifest) => manifest.riskTier,
    }).defineContracts();
    return {
      severity: "OK",
      message: "project Zod schemas are compatible with TraceGate structural safeParse adapters.",
    };
  } catch (error) {
    return {
      severity: "FAIL",
      message: `project schema compatibility check failed: ${getErrorMessage(error)}. Use createLooseManifestContractAdapter() or any schema object exposing safeParse(input).`,
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
    "  tracegate init [--config tracegate.config.ts] [--force]",
    "  tracegate test [--case id] [--policy] [--concurrency n] [--json] [--junit path] [--config path]",
    "  tracegate fixtures create <trace.jsonl> --out <fixture.ts> [--runtime-gate] [--case id] [--config path] [--force]",
    "  tracegate replay <fixture.ts> [--config path] [--json] [--junit path] [--update]",
    "  tracegate replay-runtime <fixture.ts> --trace <trace.jsonl> [--json] [--junit path]",
    "  tracegate doctor [--config path]",
    "",
  ].join("\n");
}

interface StarterFile {
  path: string;
  content: string;
}

function starterFiles(cwd: string, configPath: string): StarterFile[] {
  const events = starterTraceEvents();
  return [
    { path: configPath, content: starterConfig() },
    {
      path: resolve(cwd, "tracegate/fixtures/example-runtime.ts"),
      content: starterReplayFixture(),
    },
    {
      path: resolve(cwd, "tracegate/traces/example-runtime.jsonl"),
      content: `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
    },
    {
      path: resolve(cwd, "tracegate/redaction-check.ts"),
      content: starterRedactionCheck(),
    },
  ];
}

function starterConfig(): string {
  return `import { defineMatrix } from "@tracegate/core";
import { defineTraceGateConfig } from "@tracegate/cli/config";

export default defineTraceGateConfig({
  matrix: defineMatrix([
    {
      id: "example-runtime",
      prompt: "Check that the starter read-only tool runs and returns an answer.",
      expect: {
        requiredTools: ["lookupCustomer"],
        outputKeys: ["answer"],
      },
    },
  ]),
  async runCase() {
    return {
      output: { answer: "TraceGate starter is wired." },
      events: [
        ${JSON.stringify(starterToolEvent("tool.started", "started"))},
        ${JSON.stringify(starterToolEvent("tool.succeeded", "succeeded"))},
      ],
    };
  },
});
`;
}

function starterReplayFixture(): string {
  const events = starterTraceEvents();
  const captured = summarizeReplaySource({ events });
  const expectation = createReplayExpectation(
    { events },
    {
      includeRunStatus: false,
      traceEventCountMode: "tool-boundary",
      toolEventSequenceMode: "ordered-subset",
    },
  );
  return `import { defineReplayFixture } from "@tracegate/core";

export default defineReplayFixture({
  version: "1",
  id: "example-runtime",
  case: {
    id: "example-runtime",
    prompt: "Replay the starter runtime trace.",
    expect: {},
  },
  captured: ${JSON.stringify(captured, null, 2)},
  expect: ${JSON.stringify(expectation, null, 2)},
  metadata: {
    source: "tracegate/traces/example-runtime.jsonl",
    sourceKind: "runtime-gate",
  },
});
`;
}

function starterRedactionCheck(): string {
  return `import { assertNoSecretLikeValues, redactValue } from "@tracegate/core";

const tracePayload = redactValue(
  {
    input: {
      apiKey: "sk-proj-example-secret-value",
      authorization: "Bearer starter-token",
    },
  },
  { replacement: "[REDACTED]" },
);

assertNoSecretLikeValues(tracePayload, {
  ignoreRedactionPlaceholders: true,
});

console.log("TraceGate redaction check passed.");
`;
}

function starterToolEvent(
  type: "tool.started" | "tool.succeeded",
  status: "started" | "succeeded",
): ToolTraceEvent {
  const timestamp = status === "started" ? "2026-01-01T00:00:00.000Z" : "2026-01-01T00:00:01.000Z";
  return ToolTraceEventSchema.parse({
    sequence: status === "started" ? 1 : 2,
    type,
    timestamp,
    runId: "starter-runtime",
    record: {
      id: "tool-starter-lookup",
      runId: "starter-runtime",
      toolName: "lookupCustomer",
      timestamp,
      status,
      riskTier: "read",
      input: { customerId: "cust_123" },
      ...(status === "succeeded"
        ? { output: { answer: "TraceGate starter is wired.", customerId: "cust_123" } }
        : {}),
      policyVerdict: {
        status: "allow",
        reasons: ["Starter read-only tool is allowed."],
        riskTier: "read",
        toolName: "lookupCustomer",
      },
    },
  });
}

function starterTraceEvents(): ToolTraceEvent[] {
  return [
    starterToolEvent("tool.started", "started"),
    starterToolEvent("tool.succeeded", "succeeded"),
  ];
}

async function readOptionalFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function findTraceGateImports(source: string): string[] {
  const imports = new Set<string>();
  let index = 0;

  while (index < source.length) {
    index = skipTrivia(source, index);
    const stringLiteral = readQuotedString(source, index);
    if (stringLiteral) {
      index = stringLiteral.end;
      continue;
    }
    const token = readIdentifierToken(source, index);
    if (!token) {
      index += 1;
      continue;
    }

    if (token.value === "import") {
      index = readImportSpecifier(source, token.end, imports);
      continue;
    }
    if (token.value === "export") {
      index = readExportSpecifier(source, token.end, imports);
      continue;
    }
    index = token.end;
  }

  return [...imports].sort();
}

function readImportSpecifier(source: string, start: number, imports: Set<string>): number {
  let index = skipTrivia(source, start);
  if (source[index] === "(") {
    index = skipTrivia(source, index + 1);
    const specifier = readQuotedString(source, index);
    if (specifier?.value.startsWith("@tracegate/")) {
      imports.add(specifier.value);
    }
    return specifier?.end ?? index + 1;
  }

  const sideEffectImport = readQuotedString(source, index);
  if (sideEffectImport) {
    if (sideEffectImport.value.startsWith("@tracegate/")) {
      imports.add(sideEffectImport.value);
    }
    return sideEffectImport.end;
  }

  return readFromSpecifier(source, index, imports);
}

function readExportSpecifier(source: string, start: number, imports: Set<string>): number {
  return readFromSpecifier(source, skipTrivia(source, start), imports);
}

function readFromSpecifier(source: string, start: number, imports: Set<string>): number {
  let index = start;
  while (index < source.length) {
    index = skipTrivia(source, index);
    if (source[index] === ";") {
      return index + 1;
    }
    const stringLiteral = readQuotedString(source, index);
    if (stringLiteral) {
      index = stringLiteral.end;
      continue;
    }
    const token = readIdentifierToken(source, index);
    if (!token) {
      index += 1;
      continue;
    }
    if (token.value === "from") {
      const specifier = readQuotedString(source, skipTrivia(source, token.end));
      if (specifier?.value.startsWith("@tracegate/")) {
        imports.add(specifier.value);
      }
      return specifier?.end ?? token.end;
    }
    index = token.end;
  }
  return index;
}

function skipTrivia(source: string, start: number): number {
  let index = start;
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (/\s/.test(char ?? "")) {
      index += 1;
      continue;
    }
    if (char === "/" && next === "/") {
      const end = source.indexOf("\n", index + 2);
      index = end === -1 ? source.length : end + 1;
      continue;
    }
    if (char === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      index = end === -1 ? source.length : end + 2;
      continue;
    }
    return index;
  }
  return index;
}

function readIdentifierToken(
  source: string,
  start: number,
): { value: string; end: number } | undefined {
  const char = source[start];
  if (!char || !/[A-Za-z_$]/.test(char)) {
    return undefined;
  }
  let end = start + 1;
  while (end < source.length && /[A-Za-z0-9_$]/.test(source[end] ?? "")) {
    end += 1;
  }
  return { value: source.slice(start, end), end };
}

function readQuotedString(
  source: string,
  start: number,
): { value: string; end: number } | undefined {
  const quote = source[start];
  if (quote !== '"' && quote !== "'" && quote !== "`") {
    return undefined;
  }
  let value = "";
  let index = start + 1;
  while (index < source.length) {
    const char = source[index];
    if (char === "\\") {
      value += source.slice(index, index + 2);
      index += 2;
      continue;
    }
    if (char === quote) {
      return { value, end: index + 1 };
    }
    value += char;
    index += 1;
  }
  return undefined;
}

async function readResolvedPackage(
  cwd: string,
  specifier: string,
): Promise<{ name: string; version: string } | undefined> {
  try {
    const requireFromProject = createRequire(resolve(cwd, "package.json"));
    const resolved = requireFromProject.resolve(specifier);
    const packageJsonPath = await findPackageJson(dirname(resolved));
    if (!packageJsonPath) {
      return undefined;
    }
    const manifest = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
      name?: string;
      version?: string;
    };
    if (!manifest.name || !manifest.version) {
      return undefined;
    }
    return { name: manifest.name, version: manifest.version };
  } catch {
    return undefined;
  }
}

async function findPackageJson(start: string): Promise<string | undefined> {
  let current = start;
  while (true) {
    const candidate = join(current, "package.json");
    if (await exists(candidate)) {
      return candidate;
    }
    const parent = dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

async function findNearestFile(start: string, fileName: string): Promise<string | undefined> {
  let current = start;
  const root = parse(current).root;
  while (true) {
    const candidate = join(current, fileName);
    if (await exists(candidate)) {
      return candidate;
    }
    if (current === root) {
      return undefined;
    }
    current = dirname(current);
  }
}

function majorMinor(version: string): string {
  const [major = "0", minor = "0"] = version.split(".");
  return `${major}.${minor}`;
}

function parseJsonWithComments(source: string): unknown {
  return JSON.parse(source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1"));
}
