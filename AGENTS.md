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

## Adding A New Provider

If you're adding support for a new AI backend (GitHub Copilot SDK, Claude Code's agent API, a cloud agent service, etc.), there is a dedicated handbook at [`docs/adding-new-provider/`](./docs/adding-new-provider/). It specifies the transport + RPC contract, the event taxonomy, the three-layer logging schema, the thread/turn/job/pending-request model, and the idle-watchdog + failover semantics that any new provider must honor.

Start with [`docs/adding-new-provider/README.md`](./docs/adding-new-provider/README.md) and the fit test at [`docs/adding-new-provider/00-start-here/02-when-to-add.md`](./docs/adding-new-provider/00-start-here/02-when-to-add.md). The ordered build list is at [`docs/adding-new-provider/05-implementation-checklist.md`](./docs/adding-new-provider/05-implementation-checklist.md).

Short map:

| Topic | Doc |
|---|---|
| Overview, fit test, glossary | [`00-start-here/`](./docs/adding-new-provider/00-start-here/) |
| Transport, RPC surface, event frames, server-requests | [`01-backend-contract/`](./docs/adding-new-provider/01-backend-contract/) |
| Three-layer log stack, raw NDJSON schema | [`02-logging/`](./docs/adding-new-provider/02-logging/) |
| Thread / turn / job lifecycle, persistence, pending requests | [`03-lifecycle-and-state/`](./docs/adding-new-provider/03-lifecycle-and-state/) |
| Idle watchdog, timeouts, error classification, multi-home failover | [`04-failure-handling/`](./docs/adding-new-provider/04-failure-handling/) |
| Ordered implementation checklist | [`05-implementation-checklist.md`](./docs/adding-new-provider/05-implementation-checklist.md) |

The handbook is also the authoritative reference for existing behavior — if this `AGENTS.md` and the handbook disagree, the handbook wins and this file needs an update.

## Commands

- `npm run build`
- `npm test`
- `npm run smoke`
- `npm run bun:compile`
- `npm run bun:compile:target -- <target>`
- `npm run bun:compile:all`
- `npm run serve`
- `node --import tsx src/cli.ts --help`
- `node --import tsx src/cli.ts doctor --output json`

## Binary Distribution

- Standalone release binaries are built with `bun build --compile` via `scripts/build-binary.mjs`.
- The first-class curl installer lives at repo root as [`install.sh`](./install.sh) and is published as a GitHub Release asset named `install.sh`.
- The stable installer URL is `https://github.com/yigitkonur/codex-worker/releases/latest/download/install.sh`, not `raw/main`.
- Local host-binary smoke path: `npm run bun:compile` then `node --import tsx --test test/compiled-binary.test.ts`.
- `.github/workflows/release.yml` remains the live npm release publisher on `main`; do not replace it with the binary path until the staged rollout is proven on GitHub-hosted runners.
- The staged rollout has already been proven on GitHub-hosted runners: `binary-distribution-validate` passed end to end on 2026-04-15 after the action-runtime upgrades. Treat `ENABLE_BINARY_RELEASE` as an activation switch now, not as an unverified experiment toggle.
- `.github/workflows/release.yml` now writes and uploads a `release-metadata` artifact. `.github/workflows/release-binaries.yml` depends on that artifact to recover the tag ref from the triggering `workflow_run`; do not remove or rename this handoff without updating both workflows.
- `.github/workflows/binary-distribution-validate.yml` runs on every push, pull request, and manual dispatch and exercises the Bun binary distribution path without publishing.
- `.github/workflows/release-binaries.yml` is the gated follow-up publisher for GitHub Release assets and optional Homebrew tap sync. It activates only when the repository variable `ENABLE_BINARY_RELEASE=true` is set, and it owns the write-capable publish jobs directly.
- `.github/workflows/binary-distribution-common.yml` is the shared read-only build workflow called by both validation and release publishing; keep the target matrix, checksum generation, installer asset, smoke jobs, and Homebrew formula rendering aligned there instead of duplicating logic.
- GitHub Actions runtime baseline: first-party workflow actions are on the Node-24-compatible major lines (`actions/checkout@v6`, `actions/setup-node@v6`, `actions/upload-artifact@v7`, `actions/download-artifact@v8`). Do not downgrade them back onto the deprecated Node 20 action runtime.
- Reusable workflow permissions are caller-bounded. If a called workflow needs `contents: write`, the caller job in `.github/workflows/release-binaries.yml` must grant it explicitly; job-level write permissions inside the reusable workflow are not enough on their own.
- When binary publishing is enabled, the default Homebrew path is same-repository: the publish workflow updates `Formula/codex-worker.rb` on the release branch using the built-in `GITHUB_TOKEN`.
- Keep `--bytecode` off for the Windows target too unless it has been re-verified against the current CLI entrypoint. Local verification on 2026-04-15 showed Bun 1.3.11 fails to compile `src/cli.ts` for `bun-windows-x64` with `--bytecode` enabled because the file uses top-level `await`.
- Same-repo GitHub Release creation and asset upload are expected to use the built-in `GITHUB_TOKEN` with workflow/job `contents: write` permissions. Do not introduce a separate PAT for same-repo release publishing unless GitHub-hosted runs prove the default token is insufficient.
- Pushes and tags created by the built-in `GITHUB_TOKEN` do not fan out into new `push`-triggered workflow runs. That is an intentional part of this design: the version-bump push from `release.yml` and the same-repo Homebrew formula push from `.github/workflows/release-binaries.yml` do not recursively rerun the release pipeline.
- Optional dedicated Homebrew tap mirroring is different: it writes to another repository, so it still expects `HOMEBREW_TAP_TOKEN` plus `HOMEBREW_TAP_REPO`.
- Current rollout assumption: `ENABLE_BINARY_RELEASE` and `ENABLE_HOMEBREW_TAP_SYNC` may be left `false` until remote validation passes. Do not assume the tap repo variable or secret is present.
- Operator-facing release details and platform caveats live in [`docs/distribution/binary-releases.md`](./docs/distribution/binary-releases.md).

## Verification

- Do not claim CLI behavior works unless you ran the exact command that proves it.
- Run `npm test` for code changes. If you touched daemon/client/runtime wiring, operator workflows, or command behavior, also run `npm run smoke`.
- If you changed the Bun binary build path, also run `npm run bun:compile` and `node --import tsx --test test/compiled-binary.test.ts`.
- If you changed the installer, also run `bash -n install.sh` and `node --import tsx --test test/install-script.test.ts`.
- If you changed the release-target matrix, workflow helper scripts, or Homebrew formula generation, also run `npm run bun:compile:all` or the exact `npm run bun:compile:target -- <target>` path you touched, plus `node --import tsx --test test/build-binary.test.ts test/homebrew-formula.test.ts`.
- Verify command-surface or output-format changes through the real CLI entrypoint (`node --import tsx src/cli.ts ...` or the bin script), not by code inspection alone.
- If you changed `read` or `logs`, validate against a real thread so artifact paths and display-log output are visible.
- If you changed profile, model, or account behavior, verify with `doctor`, `model list`, and the affected account command.
- If you changed GitHub Actions YAML, parse the workflow files locally before claiming they are valid.
