# Phase 05: Policy, Redaction, And Security Defaults

## Goal

Make TraceGate useful for agents that can cause side effects.

## Deliverables

- risk tier model
- policy evaluator
- confirmation contract
- redaction rules
- secret-like leakage detector
- mutation-policy test cases
- policy cookbook docs for common production agent risks
- redaction threat model doc

## Risk Tiers

- `read`: no side effect
- `low`: local or harmless mutation
- `medium`: user-visible mutation
- `high`: money, credentials, account changes, external communication, production write
- `critical`: irreversible or privileged action

## Policy Inputs

- tool contract
- tool input
- surface context
- user role
- approval state
- environment
- custom team rules

## Redaction Defaults

Redact:

- API keys
- bearer tokens
- passwords
- private keys
- session cookies
- email body fields when marked sensitive
- payment/account identifiers when configured

## Mutation Tests

Add tests that try to:

- bypass approval wording
- inject secret-like data into traces
- call a high-risk tool through a low-risk alias
- omit required evidence
- mutate tool inputs after policy approval

## Docs

- `docs/guides/policy-cookbook.md`: refunds, email, database writes, file edits, shell commands, deploys
- `docs/guides/redaction.md`: default redactions, custom redactors, snapshot expectations
- `docs/concepts/side-effect-boundaries.md`: why prompt-only guardrails are insufficient for tools
- `docs/agent-skills/review-policy.md`: coding-agent checklist for proposing policy changes safely

## Verification

- policy tests prove blocked tools do not execute
- trace snapshots prove secrets are redacted
- CLI policy mode exits non-zero on unsafe behavior
- docs include at least one blocked-tool example and one secret-redaction example
