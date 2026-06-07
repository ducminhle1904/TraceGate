# Review Policy Skill Guide

Use this checklist when a coding agent proposes TraceGate policy changes.

## Checklist

- Identify every side-effecting tool and its `riskTier`.
- Require approval for `high` and `critical` tiers unless there is a written reason not to.
- Add required evidence for money movement, account changes, external communication, and production writes.
- Verify denied approval blocks execution.
- Verify missing evidence returns `review`.
- Add redaction checks for secrets, email bodies, tokens, cookies, and account identifiers.
- Do not weaken production policy in broad environment overrides.

## Output Shape

Policy review findings should include:

- tool name
- risk tier
- observed policy
- missing approval or evidence requirement
- test that should be added
