import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { createJiti } from "jiti";

import { normalizeTraceGateConfig, type TraceGateConfig } from "./config.js";
import { getErrorMessage, isNodeError } from "./errors.js";

export const DEFAULT_CONFIG_FILE = "tracegate.config.ts";

export interface LoadedTraceGateConfig {
  path: string;
  config: TraceGateConfig;
}

export async function loadTraceGateConfig(input: {
  cwd: string;
  configPath?: string;
}): Promise<LoadedTraceGateConfig> {
  const configPath = resolve(input.cwd, input.configPath ?? DEFAULT_CONFIG_FILE);
  try {
    await access(configPath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new Error(
        `TraceGate config not found at ${configPath}. Run "tracegate init" or pass --config <path>.`,
      );
    }
    throw error;
  }

  let loaded: unknown;
  try {
    loaded = await loadTypeScriptModule(configPath);
  } catch (error) {
    throw new Error(
      `Failed to load TraceGate config at ${configPath}: ${getErrorMessage(error)}. Make sure @tracegate/core and @tracegate/cli are installed in this project and the config uses supported static imports.`,
    );
  }

  try {
    return {
      path: configPath,
      config: normalizeTraceGateConfig(unwrapDefault(loaded)),
    };
  } catch (error) {
    throw new Error(`Invalid TraceGate config at ${configPath}: ${getErrorMessage(error)}`);
  }
}

export async function loadTypeScriptModule(path: string): Promise<unknown> {
  const jiti = createJiti(import.meta.url, {
    interopDefault: true,
    moduleCache: false,
  });
  return jiti.import<unknown>(path, { default: true });
}

export function unwrapDefault(value: unknown): unknown {
  if (typeof value === "object" && value !== null && "default" in value) {
    return (value as { default: unknown }).default;
  }

  return value;
}
