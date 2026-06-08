# Release Checklist

This checklist is the source of truth for package-visible changes. Publishing remains manual
through the `Manual Release` GitHub Actions workflow.

## Before Publishing

- Confirm package-visible changes include a changeset with `pnpm changeset`.
- Run the full local verification suite:
  - `pnpm lint`
  - `pnpm type-check`
  - `pnpm test`
  - `pnpm build`
  - `pnpm docs:build`
  - `pnpm examples:check`
  - `pnpm release:smoke`
- Confirm CI is green on the release PR.
- Confirm publishable package dependencies use npm versions or are rewritten by the publish flow,
  not leaked as `workspace:*`.
- Confirm package `files`, `exports`, README content, license, repository, bugs, homepage,
  and keywords.
- Decide whether optional adapter SDKs should remain peer dependencies.
- Create release notes that separate core, CLI, adapters, examples, and docs changes.

## Manual Publish

- Ensure the repository secret `NPM_TOKEN` is configured.
- Run the `Manual Release` workflow from GitHub Actions.
- The workflow installs dependencies, reruns verification, and publishes with `pnpm changeset publish`.
- Do not publish from push or tag automation until the project has a stable release cadence.

After publishing, run `pnpm release:smoke:registry` with the released version in `package.json`
to verify the registry packages install in a fresh consumer.
