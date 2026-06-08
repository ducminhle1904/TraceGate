import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const args = process.argv.slice(2);
const registryIndex = args.indexOf("--registry");
const currentVersion = JSON.parse(
  readFileSync(join(repoRoot, "packages/core/package.json"), "utf8"),
).version;
const registryVersion =
  registryIndex >= 0 ? (args[registryIndex + 1] ?? currentVersion) : undefined;
const tempRoot = mkdtempSync(join(tmpdir(), "tracegate-release-smoke-"));

try {
  const consumerDir = join(tempRoot, "consumer");
  if (registryVersion === undefined) {
    run("pnpm", ["build"], { cwd: repoRoot });
  }
  mkdirSync(consumerDir, { recursive: true });

  const packages =
    registryVersion === undefined
      ? packLocalPackages(tempRoot)
      : {
          core: `@tracegate/core@${registryVersion}`,
          cli: `@tracegate/cli@${registryVersion}`,
          adapters: `@tracegate/adapters@${registryVersion}`,
        };

  writeFileSync(
    join(consumerDir, "package.json"),
    JSON.stringify(
      {
        name: "tracegate-release-smoke-consumer",
        private: true,
        type: "module",
        packageManager: "pnpm@10.33.0",
        ...(registryVersion === undefined
          ? { pnpm: { overrides: { "@tracegate/core": packages.core } } }
          : {}),
      },
      null,
      2,
    ),
  );

  run("pnpm", ["add", "-D", packages.core, packages.cli, packages.adapters], {
    cwd: consumerDir,
  });
  writeFileSync(
    join(consumerDir, "tracegate.config.ts"),
    `import { defineMatrix } from "@tracegate/core";
import { defineTraceGateConfig } from "@tracegate/cli/config";

export default defineTraceGateConfig({
  matrix: defineMatrix([{ id: "smoke", prompt: "Smoke", expect: {} }]),
  async runCase() {
    return { events: [] };
  },
});
`,
  );

  run(
    "node",
    [
      "--input-type=module",
      "-e",
      [
        'import { createRequire } from "node:module";',
        "const require = createRequire(import.meta.url);",
        'const core = await import("@tracegate/core");',
        'const cli = await import("@tracegate/cli/config");',
        'const otel = await import("@tracegate/adapters/opentelemetry");',
        'const cjsCore = await require("@tracegate/core/cjs").loadTraceGateCore();',
        'if (typeof core.defineToolContract !== "function") throw new Error("core import failed");',
        'if (typeof core.createRuntimeGate !== "function") throw new Error("runtime gate import failed");',
        'if (typeof cjsCore.createRuntimeGate !== "function") throw new Error("core CJS loader failed");',
        'if (typeof cli.defineTraceGateConfig !== "function") throw new Error("cli/config import failed");',
        'if (typeof otel.mapTraceEventToOpenTelemetryAttributes !== "function") throw new Error("adapters import failed");',
      ].join(" "),
    ],
    { cwd: consumerDir },
  );
  run("pnpm", ["exec", "tracegate", "--help"], { cwd: consumerDir });
  run("pnpm", ["exec", "tracegate", "doctor"], { cwd: consumerDir });

  console.log(
    registryVersion === undefined
      ? "TraceGate release smoke passed for local packed packages."
      : `TraceGate release smoke passed for registry version ${registryVersion}.`,
  );
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

function packLocalPackages(tempRoot) {
  const packDir = join(tempRoot, "packs");
  const packageDirs = {
    core: "packages/core",
    cli: "packages/cli",
    adapters: "packages/adapters",
  };
  const packed = {};

  mkdirSync(packDir, { recursive: true });

  for (const [key, packageDir] of Object.entries(packageDirs)) {
    const output = run("pnpm", ["pack", "--pack-destination", packDir], {
      cwd: join(repoRoot, packageDir),
      capture: true,
    }).trim();
    const packOutputPath = output.split(/\s+/).at(-1);
    if (!packOutputPath) {
      throw new Error(`pnpm pack produced no tarball path for ${packageDir}`);
    }
    const tarball = isAbsolute(packOutputPath) ? packOutputPath : join(packDir, packOutputPath);
    const manifest = JSON.parse(
      run("tar", ["-xOf", tarball, "package/package.json"], {
        cwd: repoRoot,
        capture: true,
      }),
    );
    assertNoWorkspaceDependencies(manifest, basename(tarball));
    packed[key] = tarball;
  }

  return packed;
}

function assertNoWorkspaceDependencies(manifest, label) {
  for (const field of [
    "dependencies",
    "peerDependencies",
    "optionalDependencies",
    "devDependencies",
  ]) {
    for (const [name, version] of Object.entries(manifest[field] ?? {})) {
      if (typeof version === "string" && version.startsWith("workspace:")) {
        throw new Error(`${label} has ${field}.${name}=${version}`);
      }
    }
  }
}

function run(command, args, options) {
  return execFileSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
}
