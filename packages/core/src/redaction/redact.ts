const DEFAULT_SECRET_KEYS = new Set([
  "apikey",
  "api_key",
  "authorization",
  "bearer",
  "cookie",
  "password",
  "privatekey",
  "private_key",
  "refreshtoken",
  "refresh_token",
  "secret",
  "sessioncookie",
  "session_cookie",
  "token",
  "accesstoken",
  "access_token",
]);

const DEFAULT_SECRET_PATTERNS: Array<{ kind: SecretLeakKind; pattern: RegExp }> = [
  { kind: "bearer-token", pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/ },
  { kind: "api-key", pattern: /\b(?:sk|pk|api)(?:[_-][A-Za-z0-9]+)+[A-Za-z0-9_-]{16,}\b/ },
  { kind: "api-key", pattern: /\b(?:sk|pk|api)[_-]?[A-Za-z0-9]{16,}\b/ },
  {
    kind: "private-key",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/,
  },
  { kind: "session-cookie", pattern: /\b(?:session|sid|cookie)[_=:-][A-Za-z0-9._~+/=-]{12,}\b/i },
];

export interface RedactValueOptions {
  detect?: boolean;
  keys?: string[];
  patterns?: RegExp[];
  preserveLength?: boolean;
  replacement?: string;
  maxDepth?: number;
}

export type SecretLeakKind =
  | "api-key"
  | "bearer-token"
  | "custom-pattern"
  | "secret-key"
  | "private-key"
  | "session-cookie";

export interface SecretLeakFinding {
  path: string;
  kind: SecretLeakKind;
  preview: string;
}

export class TraceGateSecretLeakError extends Error {
  readonly findings: SecretLeakFinding[];

  constructor(findings: SecretLeakFinding[]) {
    super(`Secret-like values detected: ${findings.map((finding) => finding.path).join(", ")}`);
    this.name = "TraceGateSecretLeakError";
    this.findings = findings;
  }
}

export function redactValue(value: unknown, options: RedactValueOptions = {}): unknown {
  const replacement = options.replacement ?? "[REDACTED]";
  const keys = buildSecretKeys(options);
  const maxDepth = options.maxDepth ?? 8;
  const patterns = buildSecretPatterns(options);

  return redactUnknown(value, {
    depth: 0,
    keys,
    maxDepth,
    path: "$",
    patterns,
    redactionEnabled: options.detect !== false,
    replacement,
    preserveLength: options.preserveLength === true,
  });
}

export function detectSecretLikeValues(
  value: unknown,
  options: RedactValueOptions = {},
): SecretLeakFinding[] {
  if (options.detect === false) {
    return [];
  }

  const findings: SecretLeakFinding[] = [];
  detectUnknown(value, {
    depth: 0,
    findings,
    keys: buildSecretKeys(options),
    maxDepth: options.maxDepth ?? 8,
    path: "$",
    patterns: buildSecretPatterns(options),
  });
  return findings;
}

export function assertNoSecretLikeValues(value: unknown, options: RedactValueOptions = {}): void {
  const findings = detectSecretLikeValues(value, options);
  if (findings.length > 0) {
    throw new TraceGateSecretLeakError(findings);
  }
}

interface RedactContext {
  depth: number;
  keys: Set<string>;
  maxDepth: number;
  path: string;
  patterns: Array<{ kind: SecretLeakKind; pattern: RegExp }>;
  preserveLength: boolean;
  redactionEnabled: boolean;
  replacement: string;
}

interface DetectContext {
  depth: number;
  findings: SecretLeakFinding[];
  keys: Set<string>;
  maxDepth: number;
  path: string;
  patterns: Array<{ kind: SecretLeakKind; pattern: RegExp }>;
}

function redactUnknown(value: unknown, context: RedactContext): unknown {
  if (context.depth > context.maxDepth) {
    return "[REDACTED:MAX_DEPTH]";
  }

  if (Array.isArray(value)) {
    return value.map((item, index) =>
      redactUnknown(item, {
        ...context,
        depth: context.depth + 1,
        path: `${context.path}[${index}]`,
      }),
    );
  }

  if (isPlainObject(value)) {
    const redacted: Record<string, unknown> = {};

    for (const [key, nestedValue] of Object.entries(value)) {
      redacted[key] = context.keys.has(normalizeKey(key))
        ? context.replacement
        : redactUnknown(nestedValue, {
            ...context,
            depth: context.depth + 1,
            path: joinPath(context.path, key),
          });
    }

    return redacted;
  }

  if (typeof value === "string" && context.redactionEnabled) {
    return redactString(value, context);
  }

  return value;
}

function detectUnknown(value: unknown, context: DetectContext): void {
  if (context.depth > context.maxDepth) {
    return;
  }

  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      detectUnknown(item, {
        ...context,
        depth: context.depth + 1,
        path: `${context.path}[${index}]`,
      });
    }
    return;
  }

  if (isPlainObject(value)) {
    for (const [key, nestedValue] of Object.entries(value)) {
      const path = joinPath(context.path, key);
      if (context.keys.has(normalizeKey(key))) {
        context.findings.push({ path, kind: "secret-key", preview: previewValue(nestedValue) });
        continue;
      }

      detectUnknown(nestedValue, {
        ...context,
        depth: context.depth + 1,
        path,
      });
    }
    return;
  }

  if (typeof value !== "string") {
    return;
  }

  for (const { kind, pattern } of context.patterns) {
    pattern.lastIndex = 0;
    if (pattern.test(value)) {
      context.findings.push({ path: context.path, kind, preview: previewValue(value) });
      return;
    }
  }
}

function redactString(value: string, context: RedactContext): string {
  let redacted = value;
  for (const { pattern } of context.patterns) {
    pattern.lastIndex = 0;
    redacted = redacted.replace(pattern, (match) =>
      context.preserveLength ? "*".repeat(match.length) : context.replacement,
    );
  }
  return redacted;
}

function buildSecretPatterns(
  options: RedactValueOptions,
): Array<{ kind: SecretLeakKind; pattern: RegExp }> {
  return [
    ...DEFAULT_SECRET_PATTERNS.map(({ kind, pattern }) => ({
      kind,
      pattern: toGlobalRegExp(pattern),
    })),
    ...(options.patterns ?? []).map((pattern) => ({
      kind: "custom-pattern" as const,
      pattern: toGlobalRegExp(pattern),
    })),
  ];
}

function toGlobalRegExp(pattern: RegExp): RegExp {
  return new RegExp(
    pattern.source,
    pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`,
  );
}

function buildSecretKeys(options: RedactValueOptions): Set<string> {
  return options.keys === undefined || options.keys.length === 0
    ? DEFAULT_SECRET_KEYS
    : new Set([...DEFAULT_SECRET_KEYS, ...options.keys.map(normalizeKey)]);
}

function joinPath(path: string, key: string): string {
  return path === "$" ? key : `${path}.${key}`;
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9_]/g, "");
}

function previewValue(value: unknown): string {
  return typeof value === "string" ? `[secret-like:${value.length}]` : "[secret-like:value]";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype
  );
}
