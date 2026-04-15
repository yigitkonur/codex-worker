# codex-worker

`codex-worker` is a daemon-backed CLI for driving the official `codex app-server --listen stdio://` runtime from scripts, local automation, and long-running operator workflows.

It wraps the app-server protocol in a stable shell surface with local state, resumable threads, pending-request handling, and multi-profile failover.

## Requirements

- `codex` CLI installed and authenticated
- Node.js 22+ for npm installs and source development
- No Node.js or Bun runtime required when using a GitHub Release binary

## Install

Global install:

```bash
npm install -g codex-worker
```

One-off execution:

```bash
npx codex-worker doctor
```

Standalone binary from GitHub Releases:

```bash
sudo -v ; curl -fsSL https://github.com/yigitkonur/codex-worker/releases/latest/download/install.sh | sudo bash
codex-worker doctor
```

User-local install without `sudo`:

```bash
curl -fsSL https://github.com/yigitkonur/codex-worker/releases/latest/download/install.sh | bash -s -- --install-dir "$HOME/.local/bin"
```

Manual binary install remains available:

```bash
curl -LO https://github.com/yigitkonur/codex-worker/releases/latest/download/codex-worker-linux-x64
curl -LO https://github.com/yigitkonur/codex-worker/releases/latest/download/codex-worker-linux-x64.sha256
sha256sum -c codex-worker-linux-x64.sha256
chmod +x codex-worker-linux-x64
mv codex-worker-linux-x64 /usr/local/bin/codex-worker
```

Homebrew from this repository, once binary publishing is enabled:

```bash
brew tap yigitkonur/codex-worker https://github.com/yigitkonur/codex-worker
brew install yigitkonur/codex-worker/codex-worker
```

From source:

```bash
npm install
npm run build
node dist/src/cli.js --help
```

The repository now includes a live Bun-binary distribution pipeline. Every push validates the binary distribution path, GitHub Releases publish the standalone binaries, and the installer script is shipped as a release asset. Full rollout details live in [`docs/distribution/binary-releases.md`](./docs/distribution/binary-releases.md).

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
npm run bun:compile
node --import tsx src/cli.ts --help
```

`npm run smoke` exercises a live local flow against the installed `codex` binary.
