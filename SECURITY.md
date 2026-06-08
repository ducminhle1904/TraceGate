# Security Policy

TraceGate is a local-first harness for agent tool-call contracts, replay fixtures, and policy gates.
It can process traces and tool inputs that may contain sensitive application data, so security reports
should be handled privately.

## Supported Versions

TraceGate is pre-1.0. Security fixes target the latest published minor version unless a maintainer
announces a broader backport window.

## Reporting A Vulnerability

Use GitHub private vulnerability reporting:

https://github.com/ducminhle1904/TraceGate/security/advisories/new

Do not open a public issue for vulnerabilities. Do not include live API keys, customer data,
private traces, credentials, or production secrets in public comments, screenshots, fixtures, or logs.

## Scope

Useful reports include:

- policy bypasses that allow a blocked tool call to execute
- redaction failures that expose secret-like values in traces or reports
- replay or matrix behavior that trusts unvalidated input
- package, CLI, or adapter behavior that creates unsafe defaults

TraceGate does not replace application authorization, IAM, provider gateway controls, runtime sandboxing,
or human security review for high-risk actions.
