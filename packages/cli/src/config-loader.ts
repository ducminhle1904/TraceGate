import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { createJiti } from "jiti";

import { normalizeTraceGateConfig, type TraceGateConfig } from "./config.js";

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
  await access(configPath);
  const loaded = await loadTypeScriptModule(configPath);

  return {
    path: configPath,
    config: normalizeTraceGateConfig(unwrapDefault(loaded)),
  };
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
