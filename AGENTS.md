# AGENTS

## Scope

- This repo is a standalone Node 22+/TypeScript ESM CLI package named `codex-worker`.
- The primary surface is the CLI in `src/cli.ts`; `bin/codex-worker.mjs` loads the compiled CLI entrypoint from `dist/src/cli.js`.
- Keep command names and output shape stable unless the user explicitly asks for a CLI change.
- Current CLI surface from `--help`: `run`, `send`, `read`, `logs`, `thread start|resume|read|list`, `turn start|steer|interrupt`, `model list`, `account read|rate-limits`, `skills list`, `app list`, `request list|read|respond`, `wait`, `doctor`, `daemon start|status|stop`.
- There is no dedicated top-level `job` command in the current CLI. Jobs are local records returned in turn payloads, and `wait` can target `--job-id`.

## Runtime Entry Points

- Preferred entrypoints: `bin/codex-worker.mjs`, `node --import tsx src/cli.ts`, and `npm run serve` for the hidden `daemon-run` path.
- Programmatic exports live in `src/index.ts`: `sendDaemonRequest`, `ensureDaemonMeta`, `daemonIsRunning`, `CliCodexWorkerService`, and `PersistentStore`.
- Daemon autostart goes through `src/daemon/client.ts`; preserve the socket/token handshake written to `daemon.json`.
- The runtime launches `codex app-server --listen stdio://` from `src/runtime/app-server.ts` and injects `CODEX_HOME` for the selected profile.

## State And Operator Workflow

- State root defaults to `~/.codex-worker`; `CODEX_WORKER_STATE_DIR` overrides it, with `CLI_CODEX_WORKER_STATE_DIR` kept as a backward-compatible fallback.
- Persistent files live under that root: `registry.json`, `daemon.json`, `daemon.sock`, `workspaces/<workspace-hash>/threads/<thread-id>.jsonl`, `workspaces/<workspace-hash>/logs/<thread-id>.output`, and `workspaces/<workspace-hash>/logs/<thread-id>.raw.ndjson`.
- `read` and `thread read` are session-reader commands: they surface local thread/turn/request state plus transcript/log/raw artifact paths and recent tails.
- `logs` prefers the readable deduplicated `displayLog` synthesized from transcript events and falls back to raw log tail.
- Pending app-server requests are persisted locally and answered later through `request list|read|respond`.

## Logging & Debugging

Three files per thread, each at a different abstraction level. Pick by intent.

### 1. `<thread-id>.raw.ndjson` — firehose (added 0.1.4)

Path: `~/.codex-worker/workspaces/<hash>/logs/<thread-id>.raw.ndjson`.
Every app-server event, verbatim, one JSON object per line.

Envelope: `{ ts, dir, method?, id?, params?, result?, error?, data?, message? }` where `dir` is one of:
- `rpc_out` — daemon → app-server (`initialize`, `thread/start`, `thread/resume`, `turn/start`, `account/read`, …)
- `rpc_in` — RPC result returned to daemon
- `notification` — app-server push event (`turn/started`, `turn/completed`, `item/started`, `item/completed`, `item/agentMessage/delta`, `item/commandExecution/outputDelta`, `thread/tokenUsage/updated`, `hook/started`, `hook/completed`, `mcpServer/startupStatus/updated`, `thread/status/changed`, `error`)
- `server_request` — app-server asking the daemon for input (`item/tool/requestUserInput`, approval prompts)
- `stderr` — raw stderr chunk from the `codex` child
- `exit` — child exited (`{ code, signal }`)
- `protocol_error` — undecodable RPC line
- `daemon` — our own lifecycle markers (`launchTurn`, `completeExecution`, `failExecution`, `watchdog_fire`)

Opt out with `CODEX_WORKER_RAW_LOG=0`.
Location hint: `thread read` now returns `artifacts.rawLogPath` in its JSON payload.

### 2. `<thread-id>.jsonl` — deduplicated transcript

Structured events the daemon chose to surface: assistant deltas, tool output deltas, server requests persisted for later `request respond`, user prompts. Good for replaying a session in order. One line per logical event. No wire-level detail.

### 3. `<thread-id>.output` — human log tail

Plain-text tail fed by `handleNotification`'s `logLine` calls. One word per line for assistant deltas, which looks like noise alone but drives the `logs` command's readable summary.

### Diagnostic recipes

**"Is this thread stuck or still working?"** Tail the raw log; if `notification` lines keep arriving, it is working. Silence for more than a few seconds on a large turn is the real stuck signal.
```
tail -f ~/.codex-worker/workspaces/<hash>/logs/<thread-id>.raw.ndjson
```

**"What methods fired, at what counts?"** Balanced `item/started` and `item/completed` = healthy tool loop. An imbalance points at a hung tool.
```
grep -oE '"method":"[^"]+"' <thread>.raw.ndjson | sort | uniq -c | sort -rn
```

**"Why did the turn fail?"** Look for `dir:"daemon"` lines with `message:"watchdog_fire …"` (our idle-timeout fire), `dir:"exit"` (codex child died), or `method:"error"` notifications.
```
jq -c 'select(.dir=="daemon" or .dir=="exit" or .method=="error")' <thread>.raw.ndjson
```

**"Did a turn really complete?"** If `method:"turn/completed"` is absent and status is `failed`, the daemon terminated it — check the adjacent `watchdog_fire` or `failExecution` markers for the reason.
```
jq -c 'select(.method=="turn/started" or .method=="turn/completed" or .dir=="daemon")' <thread>.raw.ndjson
```

**"Which RPCs did we send and in what order?"** Full wire trace both directions:
```
jq -c 'select(.dir=="rpc_out" or .dir=="rpc_in") | {ts, dir, id, method}' <thread>.raw.ndjson
```

### Inference rules

- `turn/started` without `turn/completed` AND thread `status=failed` → the daemon killed the turn. Read the `daemon` line just before to see why.
- Steady stream of `hook/started|completed` + `item/started|completed` + periodic `thread/tokenUsage/updated` = healthy progress; do not interpret `Status: active` as stuck.
- `server_request` with no subsequent `rpc_out` responding to it = a pending request waiting for `request respond`; the turn's `execution.settled` has been flipped and the thread is `waiting_request`.
- `stderr` lines from the codex child are rare but high-signal — copy them verbatim into bug reports.
- When authenticating a custom provider: `account/read` returning `{ account: null, requiresOpenaiAuth: false }` is normal, not an error; that is `requires_openai_auth = false` in `~/.codex/config.toml` being honored.

### Turn idle-timeout (added 0.1.5)

- `launchTurn` arms an idle watchdog. Default window is 30 min; override with `CODEX_WORKER_TURN_TIMEOUT_MS=<ms>`.
- The timer resets on every `notification`, `server_request`, and other app-server activity — it only fires when the wire has been silent for the full window.
- On fire: a `dir:"daemon"` line `watchdog_fire turnId=… idle_ms=… limit_ms=…` is emitted to the raw log, then `failExecution` runs, then the codex child is `SIGTERM`'d. Thread ends in `failed` with `lastError` describing the idle duration.

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
