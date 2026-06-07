# Contributing

TraceGate is in Phase 0. The repo is being prepared for a TypeScript monorepo with a core harness package, CLI, adapters, examples, and documentation.

## Setup

```bash
pnpm install
```

## Verification

Run these before opening a pull request:

```bash
pnpm type-check
pnpm lint
pnpm test
```

Phase 0 scripts are allowed to be placeholders until packages exist, but they must exit cleanly.

## Contribution Guidelines

- Keep changes scoped to one phase or one capability.
- Update docs with every public-facing behavior change.
- Prefer small examples over broad claims.
- Do not position TraceGate as an agent framework or observability clone.
- Make contracts explicit: tool shape, risk tier, policy result, trace output, and CI behavior.
- Avoid adding runtime dependencies before the package that needs them exists.

## Issues And Pull Requests

- Use issues to describe the agent behavior, tool risk, replay gap, or docs gap being addressed.
- In pull requests, include the commands you ran and the relevant output summary.
- For docs changes, verify links locally and explain what developer question the doc now answers.
