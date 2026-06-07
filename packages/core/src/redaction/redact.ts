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

export interface RedactValueOptions {
  keys?: string[];
  replacement?: string;
  maxDepth?: number;
}

export function redactValue(value: unknown, options: RedactValueOptions = {}): unknown {
  const replacement = options.replacement ?? "[REDACTED]";
  const keys =
    options.keys === undefined || options.keys.length === 0
      ? DEFAULT_SECRET_KEYS
      : new Set([...DEFAULT_SECRET_KEYS, ...options.keys.map(normalizeKey)]);
  const maxDepth = options.maxDepth ?? 8;

  return redactUnknown(value, keys, replacement, 0, maxDepth);
}

function redactUnknown(
  value: unknown,
  keys: Set<string>,
  replacement: string,
  depth: number,
  maxDepth: number,
): unknown {
  if (depth > maxDepth) {
    return "[REDACTED:MAX_DEPTH]";
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactUnknown(item, keys, replacement, depth + 1, maxDepth));
  }

  if (isPlainObject(value)) {
    const redacted: Record<string, unknown> = {};

    for (const [key, nestedValue] of Object.entries(value)) {
      redacted[key] = keys.has(normalizeKey(key))
        ? replacement
        : redactUnknown(nestedValue, keys, replacement, depth + 1, maxDepth);
    }

    return redacted;
  }

  return value;
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9_]/g, "");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype
  );
}
