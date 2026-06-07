import { writeFile } from "node:fs/promises";

export type MatrixCaseResultStatus = "passed" | "failed";
export type MatrixReportStatus = "passed" | "failed";

export interface MatrixCaseResult {
  id: string;
  status: MatrixCaseResultStatus;
  durationMs: number;
  failures: string[];
  outputSummary?: string;
  runId?: string;
  traceEventCount: number;
}

export interface MatrixReport {
  version: "1";
  status: MatrixReportStatus;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  counts: {
    total: number;
    passed: number;
    failed: number;
  };
  cases: MatrixCaseResult[];
}

export function createMatrixReport(input: {
  startedAt: Date;
  finishedAt: Date;
  cases: MatrixCaseResult[];
}): MatrixReport {
  const failed = input.cases.filter((result) => result.status === "failed").length;
  const passed = input.cases.length - failed;

  return {
    version: "1",
    status: failed > 0 ? "failed" : "passed",
    startedAt: input.startedAt.toISOString(),
    finishedAt: input.finishedAt.toISOString(),
    durationMs: input.finishedAt.getTime() - input.startedAt.getTime(),
    counts: {
      total: input.cases.length,
      passed,
      failed,
    },
    cases: input.cases,
  };
}

export function formatConsoleReport(report: MatrixReport): string {
  const lines = [
    `TraceGate matrix: ${report.counts.passed} passed, ${report.counts.failed} failed, ${report.counts.total} total`,
  ];

  for (const result of report.cases) {
    lines.push(`${result.status === "passed" ? "PASS" : "FAIL"} ${result.id}`);
    for (const failure of result.failures) {
      lines.push(`  - ${failure}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export async function writeJunitReport(report: MatrixReport, filePath: string): Promise<void> {
  await writeFile(filePath, formatJunitReport(report), "utf8");
}

export function formatJunitReport(report: MatrixReport): string {
  const testcases = report.cases
    .map((result) => {
      const failureBody = escapeXml(result.failures.join("\n"));
      const failures = result.failures
        .map((failure) => `<failure message="${escapeXml(failure)}">${failureBody}</failure>`)
        .join("");
      return `<testcase classname="TraceGate.Matrix" name="${escapeXml(result.id)}" time="${(result.durationMs / 1000).toFixed(3)}">${failures}</testcase>`;
    })
    .join("");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuite name="TraceGate Matrix" tests="${report.counts.total}" failures="${report.counts.failed}" time="${(report.durationMs / 1000).toFixed(3)}">`,
    testcases,
    "</testsuite>",
    "",
  ].join("\n");
}

export function summarizeOutput(output: unknown): string | undefined {
  if (output === undefined) {
    return undefined;
  }

  if (output !== null && typeof output === "object" && !Array.isArray(output)) {
    return `object keys: ${Object.keys(output).join(", ") || "(none)"}`;
  }

  const serialized = safeSerialize(output);
  return serialized.length > 120 ? `${serialized.slice(0, 117)}...` : serialized;
}

function safeSerialize(output: unknown): string {
  try {
    return JSON.stringify(output) ?? String(output);
  } catch {
    return "[unserializable output]";
  }
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
