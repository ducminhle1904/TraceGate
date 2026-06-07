# Configuration Reference

TraceGate CLI configuration starts with `tracegate.config.ts` in the project root.

## Planned Surfaces

- Core harness options.
- Tool contract definitions.
- Policy rules.
- Redaction rules.
- Trace sink configuration.
- CLI matrix configuration through `matrix` and `runCase`.

## CLI Defaults

- Default config file: `tracegate.config.ts`.
- Override config path with `tracegate test --config <path>` or `tracegate doctor --config <path>`.
- TypeScript config files are loaded with `jiti`.
- The project owns `runCase()`; TraceGate does not instantiate an agent framework.

## Defaults To Preserve

- Local-first operation.
- JSONL-friendly traces.
- Redaction by default for known secret-like fields.
- Framework-neutral naming.

## Next-Phase TODOs

- Add policy/redaction config after Phase 5.
- Add adapter-specific config after Phase 6.
