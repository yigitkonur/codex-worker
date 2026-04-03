# cli-codex-worker

`cli-codex-worker` is a daemon-backed CLI that orchestrates the official `codex app-server --listen stdio://` runtime.

It provides:

- Protocol-first commands for thread/turn/model/account/request flows
- Friendly aliases (`run`, `send`, `read`) for file-based prompt workflows
- Pending server-request persistence (`request list/read/respond`)
- Multi-account failover across `CODEX_HOME_DIRS` with cooldown tracking
- Model validation/remap from live `model/list`

## Requirements

- Node.js 22+
- `codex` CLI installed and logged in

## Install

```bash
npm install
npm run build
```

## Core Commands

```text
cli-codex-worker daemon start|status|stop
cli-codex-worker thread start|resume|read|list
cli-codex-worker turn start|steer|interrupt
cli-codex-worker model list
cli-codex-worker account read|rate-limits
cli-codex-worker skills list
cli-codex-worker app list
cli-codex-worker request list|read|respond
cli-codex-worker wait
cli-codex-worker doctor
```

## Friendly Aliases

```text
cli-codex-worker run <task.md>
cli-codex-worker send <thread-id> <message.md>
cli-codex-worker read <thread-id>
```

These aliases still return and surface thread/turn IDs so workflow stays protocol-compatible.

## Multi-Account Failover

- `CODEX_HOME_DIRS` (colon-separated) controls account order.
- Each account tracks cooldown after classified failures.
- `CODEX_HOME` is used when `CODEX_HOME_DIRS` is not set.

Example:

```bash
export CODEX_HOME_DIRS="$HOME/.codex:/tmp/second-codex-home"
```

## Fleet Toggle

Set:

```bash
export CODEX_ENABLE_FLEET=1
```

When enabled, a `cli-codex-worker:fleet` suffix is appended to outgoing `developerInstructions` on thread-start/resume paths.

## Pending Requests

When app-server sends approval/input/auth-refresh requests, they are persisted locally and can be answered later:

```bash
cli-codex-worker request list
cli-codex-worker request read <request-id>
cli-codex-worker request respond <request-id> --json '{"decision":"accept"}'
```

For tool user-input requests:

```bash
cli-codex-worker request respond <request-id> --answer "yes"
```

## Verification Commands

```bash
npm run build
npm test
npm run smoke
```

`npm run smoke` validates a live flow with the installed `codex` binary:

1. initialize
2. model/list
3. run alias (thread + turn) writing a file
4. thread/read and output file check
