# codex-worker

`codex-worker` is a daemon-backed CLI for driving the official `codex app-server --listen stdio://` runtime from scripts, local automation, and long-running operator workflows.

It wraps the app-server protocol in a stable shell surface with local state, resumable threads, pending-request handling, and multi-profile failover.

## Requirements

- Node.js 22+
- `codex` CLI installed and authenticated

## Install

Global install:

```bash
npm install -g codex-worker
```

One-off execution:

```bash
npx codex-worker doctor
```

From source:

```bash
npm install
npm run build
node dist/src/cli.js --help
```

## CLI Surface

```text
codex-worker run <task.md>
codex-worker send <thread-id> <message.md>
codex-worker read <thread-id>
codex-worker logs <thread-id>
codex-worker thread start|resume|read|list
codex-worker turn start|steer|interrupt
codex-worker model list
codex-worker account read|rate-limits
codex-worker skills list
codex-worker app list
codex-worker request list|read|respond
codex-worker wait
codex-worker doctor
codex-worker daemon start|status|stop
```

## Common Flows

Start a file-backed task:

```bash
codex-worker run task.md
```

Resume a thread with a follow-up prompt:

```bash
codex-worker send <thread-id> followup.md
```

Read local thread state and recent transcript/log output:

```bash
codex-worker read <thread-id>
codex-worker logs <thread-id>
```

Handle a pending approval or user-input request:

```bash
codex-worker request list
codex-worker request read <request-id>
codex-worker request respond <request-id> --json '{"decision":"accept"}'
codex-worker request respond <request-id> --answer "yes"
```

## State And Environment

- Default state root: `~/.codex-worker`
- Preferred override: `CODEX_WORKER_STATE_DIR`
- Backward-compatible fallback override: `CLI_CODEX_WORKER_STATE_DIR`
- Profile discovery: `CODEX_HOME_DIRS` or `CODEX_HOME`
- Fleet toggle: `CODEX_ENABLE_FLEET=1`

When fleet mode is enabled, `codex-worker` appends a `[codex-worker:fleet]` suffix to outgoing developer instructions on thread start and resume paths.

## Development

```bash
npm run build
npm test
npm run smoke
node --import tsx src/cli.ts --help
```

`npm run smoke` exercises a live local flow against the installed `codex` binary.
