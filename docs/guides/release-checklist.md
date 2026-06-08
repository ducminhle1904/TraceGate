# Release Checklist

This is a future publishing checklist. Phase 7 does not publish npm packages or deploy a
hosted docs site.

## Before npm Publishing

- Choose public package versions.
- Confirm publishable package dependencies use npm versions, not `workspace:*`.
- Confirm package `files`, `exports`, README content, license, repository, bugs, homepage,
  and keywords.
- Run the full verification suite from the root README.
- Run `pnpm release:smoke` to pack packages, reject workspace protocol dependencies, and verify
  a temp consumer can import `@tracegate/core`, import `@tracegate/cli/config`, and run the CLI.
- Build docs with `pnpm docs:build`.
- Verify all examples run without API credentials.
- Decide whether optional adapter SDKs should remain peer dependencies.
- Create release notes that separate core, CLI, adapters, examples, and docs changes.

After publishing, run `pnpm release:smoke:registry` with the released version in
`package.json` to verify the registry packages install in a fresh consumer.

## Not Done In Phase 7

- npm publish.
- provenance signing.
- hosted documentation deployment.
- CI secret setup.
