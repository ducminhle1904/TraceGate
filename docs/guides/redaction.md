# Redaction Guide

TraceGate redaction removes common secret-like values from trace input, output, error metadata, and custom metadata before writing trace events.

## Defaults

`redactValue()` redacts common secret-like keys such as `token`, `apiKey`, `authorization`, `password`, cookies, and private keys. It also redacts common secret-like string values such as bearer tokens and private-key blocks.

```ts
redactValue({
  note: "Bearer abcdefghijklmnopqrstuvwxyz",
  visible: "ok",
});
```

Result:

```ts
{
  note: "[REDACTED]",
  visible: "ok"
}
```

## Custom Rules

```ts
createHarness({
  redaction: {
    keys: ["emailBody"],
    patterns: [/customer-secret-\d+/],
  },
});
```

Use custom keys for sensitive business fields. Use custom patterns for project-specific tokens.

## Leak Detection

```ts
const findings = detectSecretLikeValues(trace);
assertNoSecretLikeValues(trace);
```

Findings include `path`, `kind`, and a non-secret preview. Detection is deterministic and useful for tests, but it is not a complete DLP system.

## Redacted Trace Fixtures

By default, detection treats secret-like key names as suspicious even when the value is already
redacted. This preserves older behavior. For CI checks against redacted traces, opt into placeholder
tolerance:

```ts
assertNoSecretLikeValues(trace, {
  ignoreRedactionPlaceholders: true,
  redactionPlaceholders: ["[REDACTED]", "<hidden>"],
});
```

Raw values under keys such as `apiKey`, `password`, `authorization`, `cookie`, and `token` still
fail. Known placeholders such as `[REDACTED]`, `[redacted]`, `***`, and configured custom
replacements can pass.

## Snapshot Expectations

Matrix cases can assert raw secret strings are absent from traces:

```ts
expect: {
  redactionChecks: ["secret-token"],
}
```
