# codex-worker

`codex-worker` is a daemon-backed CLI for driving the official `codex app-server --listen stdio://` runtime from scripts, local automation, and long-running operator workflows.

It wraps the app-server protocol in a stable shell surface with local state, resumable threads, pending-request handling, and multi-profile failover.

## Requirements

- `codex` CLI installed and authenticated
- Node.js 22+ for npm installs and source development
- No Node.js or Bun runtime required when using a GitHub Release binary

## Install

One-line install (recommended):

```bash
sudo -v ; curl -fsSL https://github.com/yigitkonur/codex-worker/releases/latest/download/install.sh | sudo bash
codex-worker doctor
```

The installer auto-detects OS/arch/libc, downloads the matching release binary plus its `.sha256`, verifies the checksum, and writes `codex-worker` to `/usr/local/bin` as root or `~/.local/bin` otherwise.

**Override behavior:** if another `codex-worker` is earlier on `PATH` (e.g. a Homebrew symlink at `/opt/homebrew/bin/codex-worker`), the installer removes it so `which codex-worker` resolves to the freshly installed copy. Pass `--no-override` to disable. Only shadowing copies (earlier on `PATH`) are touched; copies later on `PATH` are left alone.

### Other install methods

| Method | Command |
| --- | --- |
| User-local (no sudo) | `curl -fsSL https://github.com/yigitkonur/codex-worker/releases/latest/download/install.sh \| bash -s -- --install-dir "$HOME/.local/bin"` |
| Pinned version | `... \| bash -s -- --version 0.1.17` |
| Dry-run (preview) | `... \| bash -s -- --dry-run` |
| npm global | `npm install -g codex-worker` |
| One-off via npx | `npx codex-worker doctor` |
| Homebrew tap | `brew tap yigitkonur/codex-worker https://github.com/yigitkonur/codex-worker && brew install yigitkonur/codex-worker/codex-worker` |
| From source | `npm install && npm run build && node dist/src/cli.js --help` |

Manual download (if you want to skip the installer entirely):

```bash
curl -LO https://github.com/yigitkonur/codex-worker/releases/latest/download/codex-worker-linux-x64
curl -LO https://github.com/yigitkonur/codex-worker/releases/latest/download/codex-worker-linux-x64.sha256
sha256sum -c codex-worker-linux-x64.sha256
chmod +x codex-worker-linux-x64
sudo mv codex-worker-linux-x64 /usr/local/bin/codex-worker
```

Full binary distribution details live in [`docs/distribution/binary-releases.md`](./docs/distribution/binary-releases.md).

### Installer flags

| Flag | Purpose |
| --- | --- |
| `--version <ver>` | Install a specific release tag or version number |
| `--install-dir <dir>` | Override the install directory |
| `--target <asset>` | Bypass platform auto-detection and pick a specific release asset |
| `--repo <owner/repo>` | Install from a fork with the same asset layout |
| `--force` | Reinstall even if the same version is already present |
| `--no-verify` | Skip sha256 verification |
| `--no-override` | Leave other `codex-worker` copies on `PATH` alone |
| `--dry-run` | Print the resolved install plan without downloading |

Environment overrides: `CODEX_WORKER_INSTALL_DIR`, `CODEX_WORKER_INSTALL_OS`, `CODEX_WORKER_INSTALL_ARCH`, `CODEX_WORKER_INSTALL_LIBC`, `CODEX_WORKER_INSTALL_CPU_FEATURES`, `GITHUB_TOKEN`.

### Platform notes

- `codex-worker` still requires the upstream `codex` CLI to be installed and authenticated.
- Older Linux x86_64 CPUs without `avx2` are auto-served the `codex-worker-linux-x64-baseline` build.
- Alpine / musl x86_64 without `avx2` has no published asset; build from source on those hosts.
- Windows: download the `.exe` release asset directly — the shell installer targets Unix-like shells.
- Pick Homebrew if you want package-manager-owned updates; pick the shell installer if you want the newest release immediately.

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
