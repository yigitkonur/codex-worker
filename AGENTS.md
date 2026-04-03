# AGENTS

## Scope

- This repo is a standalone Node 22+/TypeScript ESM CLI package named `cli-codex-worker`.
- The primary surface is the CLI in `src/cli.ts`; `bin/cli-codex-worker.mjs` loads that source entrypoint through `tsx`.
- Keep command names and output shape stable unless the user explicitly asks for a CLI change.
- Current CLI surface from `--help`: `run`, `send`, `read`, `logs`, `thread start|resume|read|list`, `turn start|steer|interrupt`, `model list`, `account read|rate-limits`, `skills list`, `app list`, `request list|read|respond`, `wait`, `doctor`, `daemon start|status|stop`.
- There is no dedicated top-level `job` command in the current CLI. Jobs are local records returned in turn payloads, and `wait` can target `--job-id`.

## Runtime Entry Points

- Preferred entrypoints: `bin/cli-codex-worker.mjs`, `node --import tsx src/cli.ts`, and `npm run serve` for the hidden `daemon-run` path.
- Programmatic exports live in `src/index.ts`: `sendDaemonRequest`, `ensureDaemonMeta`, `daemonIsRunning`, `CliCodexWorkerService`, and `PersistentStore`.
- Daemon autostart goes through `src/daemon/client.ts`; preserve the socket/token handshake written to `daemon.json`.
- The runtime launches `codex app-server --listen stdio://` from `src/runtime/app-server.ts` and injects `CODEX_HOME` for the selected profile.

## State And Operator Workflow

- State root defaults to `~/.cli-codex-worker`; `CLI_CODEX_WORKER_STATE_DIR` overrides it.
- Persistent files live under that root: `registry.json`, `daemon.json`, `daemon.sock`, `workspaces/<workspace-hash>/threads/<thread-id>.jsonl`, and `workspaces/<workspace-hash>/logs/<thread-id>.output`.
- `read` and `thread read` are session-reader commands: they surface local thread/turn/request state plus transcript/log artifact paths and recent tails.
- `logs` prefers the readable deduplicated `displayLog` synthesized from transcript events and falls back to raw log tail.
- Pending app-server requests are persisted locally and answered later through `request list|read|respond`.

## Models, Accounts, And Failover

- Model selection is live, not static. Resolve requested models through `model list`; aliases can remap to canonical upgrades and are surfaced as `remappedFrom`.
- Default model is `gpt-5.4`.
- Profiles come from `CODEX_HOME_DIRS` (colon-separated, deduplicated) or `CODEX_HOME`, falling back to `~/.codex`.
- Multi-account failover is cooldown-based and persisted in `registry.json`. Current cooldowns are auth `5m`, rate-limit `15m`, connection `1m`, transient `30s`, fatal `0`.
- `doctor` and `daemon status` are the fastest checks for active profiles, daemon state, socket path, and state root.
- `CODEX_ENABLE_FLEET=1` appends fleet-specific developer instructions on thread-start and thread-resume paths.

## Commands

- `npm run build`
- `npm test`
- `npm run smoke`
- `npm run serve`
- `node --import tsx src/cli.ts --help`
- `node --import tsx src/cli.ts doctor --output json`

## Verification

- Do not claim CLI behavior works unless you ran the exact command that proves it.
- Run `npm test` for code changes. If you touched daemon/client/runtime wiring, operator workflows, or command behavior, also run `npm run smoke`.
- Verify command-surface or output-format changes through the real CLI entrypoint (`node --import tsx src/cli.ts ...` or the bin script), not by code inspection alone.
- If you changed `read` or `logs`, validate against a real thread so artifact paths and display-log output are visible.
- If you changed profile, model, or account behavior, verify with `doctor`, `model list`, and the affected account command.
