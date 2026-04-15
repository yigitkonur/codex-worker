# codex-worker

`codex-worker` is a daemon-backed CLI for driving the official `codex app-server --listen stdio://` runtime from scripts, local automation, and long-running operator workflows.

It wraps the app-server protocol in a stable shell surface with local state, resumable threads, pending-request handling, and multi-profile failover.

## Requirements

- `codex` CLI installed and authenticated
- Node.js 22+ for npm installs and source development
- No Node.js or Bun runtime required when using a GitHub Release binary

## Install

Recommended standalone install from GitHub Releases:

```bash
sudo -v ; curl -fsSL https://github.com/yigitkonur/codex-worker/releases/latest/download/install.sh | sudo bash
codex-worker doctor
```

The installer selects the correct released binary for the current host, downloads the matching `.sha256` file, verifies the checksum, installs `codex-worker` into your chosen bin directory, and skips re-installing when the same version is already present.

Global install:

```bash
npm install -g codex-worker
```

One-off execution:

```bash
npx codex-worker doctor
```

User-local install without `sudo`:

```bash
curl -fsSL https://github.com/yigitkonur/codex-worker/releases/latest/download/install.sh | bash -s -- --install-dir "$HOME/.local/bin"
```

Pinned release install:

```bash
curl -fsSL https://github.com/yigitkonur/codex-worker/releases/latest/download/install.sh | bash -s -- --version 0.1.17 --install-dir "$HOME/.local/bin"
```

Inspect what the installer would do without downloading:

```bash
curl -fsSL https://github.com/yigitkonur/codex-worker/releases/latest/download/install.sh | bash -s -- --dry-run
```

Manual binary install remains available:

```bash
curl -LO https://github.com/yigitkonur/codex-worker/releases/latest/download/codex-worker-linux-x64
curl -LO https://github.com/yigitkonur/codex-worker/releases/latest/download/codex-worker-linux-x64.sha256
sha256sum -c codex-worker-linux-x64.sha256
chmod +x codex-worker-linux-x64
mv codex-worker-linux-x64 /usr/local/bin/codex-worker
```

Homebrew from this repository:

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

## Installer Details

The published installer is the same file exposed at:

```bash
https://github.com/yigitkonur/codex-worker/releases/latest/download/install.sh
```

What it does:

- Detects `Darwin` vs `Linux`
- Detects `arm64` vs `x64`
- Detects `glibc` vs `musl` on Linux
- Uses `codex-worker-linux-x64-baseline` on older Linux x86_64 CPUs that do not report `avx2`
- Downloads the matching binary plus matching `.sha256`
- Verifies the checksum before install unless `--no-verify` is passed
- Installs to `/usr/local/bin` by default as root, otherwise falls back to `~/.local/bin` when `/usr/local/bin` is not writable
- Skips reinstalling when the requested version is already installed unless `--force` is passed

Supported installer flags:

- `--version <version>` installs a specific release version or tag
- `--install-dir <dir>` installs into a custom directory
- `--target <asset-name>` bypasses platform auto-detection and installs a specific release asset
- `--repo <owner/repo>` installs from another GitHub repository with the same asset layout
- `--force` reinstalls even if the same version is already present
- `--no-verify` skips checksum verification
- `--dry-run` prints the resolved install plan without downloading

Examples:

```bash
curl -fsSL https://github.com/yigitkonur/codex-worker/releases/latest/download/install.sh | bash -s -- --version v0.1.17
curl -fsSL https://github.com/yigitkonur/codex-worker/releases/latest/download/install.sh | bash -s -- --target codex-worker-linux-x64
curl -fsSL https://github.com/yigitkonur/codex-worker/releases/latest/download/install.sh | bash -s -- --force
```

Platform caveats:

- `codex-worker` still requires the upstream `codex` CLI to be installed and authenticated
- The current installer targets Unix-like shells; Windows users should download the `.exe` release asset directly
- There is no published `linux-x64-baseline-musl` asset, so very old Alpine x86_64 systems without `avx2` are not auto-supported by the installer
- If you prefer package managers to own updates, use Homebrew instead of the shell installer

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
