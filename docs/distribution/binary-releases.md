# Binary Releases

`codex-worker` now has a staged Bun-binary distribution pipeline. The existing npm release workflow stays in place until the binary path has been validated remotely, then a gated follow-up workflow can publish standalone GitHub Release binaries and update a Homebrew formula in this same repository.

When the binary release path is enabled, those binaries bundle the runtime, so end users do not need Node.js or Bun installed. The external dependency stays the same as the npm package: the `codex` CLI must already be installed and authenticated on the target machine.

## Local Build

Build a host-platform binary from the repo checkout:

```bash
npm install
npm run bun:compile
./dist/bin/codex-worker --help
```

Build one release target explicitly:

```bash
npm run bun:compile:target -- linux-arm64
```

Build the full release matrix locally:

```bash
npm run bun:compile:all
```

The helper script resolves the workspace-pinned Bun binary from `node_modules`, so contributors do not need a global `bun` install.

## Release Workflow

The rollout is intentionally split so the current live releaser is not replaced before the new path has been exercised on every push.

Current workflow layout:

1. [`.github/workflows/release.yml`](../../.github/workflows/release.yml) remains the live npm publisher on `main`.
2. [`.github/workflows/binary-distribution-validate.yml`](../../.github/workflows/binary-distribution-validate.yml) runs on every push, pull request, and manual dispatch.
3. [`.github/workflows/release-binaries.yml`](../../.github/workflows/release-binaries.yml) follows the live release workflow via `workflow_run`, but it is gated by the repository variable `ENABLE_BINARY_RELEASE=true`.
4. [`.github/workflows/binary-distribution-common.yml`](../../.github/workflows/binary-distribution-common.yml) is the shared implementation used by both validation and publishing paths.

When binary publishing is enabled, the publish workflow does two same-repository write operations with the built-in `GITHUB_TOKEN`:

- create or update the GitHub Release and upload the binary assets
- commit `Formula/codex-worker.rb` back to the publish branch so Homebrew users can update from this repository as a custom tap

That design avoids two problems at once:

- the live release workflow is not replaced until the new path has been remotely exercised on every push
- the follow-up binary publisher does not depend on a `push.tags` workflow that GitHub’s default `GITHUB_TOKEN` would fail to trigger

## Release Targets

Current release assets:

- `codex-worker-linux-x64`
- `codex-worker-linux-x64-baseline`
- `codex-worker-linux-arm64`
- `codex-worker-linux-x64-musl`
- `codex-worker-linux-arm64-musl`
- `codex-worker-darwin-x64`
- `codex-worker-darwin-arm64`
- `codex-worker-windows-x64.exe`

Windows ARM64 is not published yet because Bun does not currently ship a native `bun-windows-arm64` compile target. Windows on ARM should use the x64 build under emulation.

## Runtime Notes

- Bun is pinned to `1.3.11` in CI and release automation. Do not float the version without re-running local and CI smoke checks.
- The Windows x64 binary currently ships without `--bytecode`. Local verification on April 15, 2026 showed Bun 1.3.11 fails to compile this CLI for `bun-windows-x64` when `--bytecode` is enabled because the entrypoint uses top-level `await`.
- The `*-musl` binaries run on Alpine, but they are not `FROM scratch` compatible.
- The `linux-x64-baseline` build exists for older x86_64 CPUs that cannot run the default Bun Linux target.
- Auto-update is integrated through a same-repository Homebrew formula update, not an in-binary self-updater. That follows Homebrew policy and keeps package-manager installs package-manager-owned.
- Windows package-manager automation is intentionally not enabled in this pass. Research favored `winget` as the next Windows channel, but it adds external-repo submission and validation work that is separate from this repo-local rollout.

## GitHub Configuration

Binary publishing is intentionally off until the repo is configured and the validation workflow has gone green remotely.

Repository variables:

- `ENABLE_BINARY_RELEASE=true` enables [`.github/workflows/release-binaries.yml`](../../.github/workflows/release-binaries.yml)
- `ENABLE_HOMEBREW_TAP_SYNC=true` optionally mirrors the generated formula to a separate dedicated tap repository after the same-repo formula update succeeds
- `HOMEBREW_TAP_REPO=<owner>/<homebrew-tap-repo>` tells the optional mirror job which tap repository to update

Same-repo Homebrew note:

- Homebrew can track any Git repository as a tap when you use the two-argument form of `brew tap`.
- Because this repository is not named `homebrew-...`, users should tap it with the explicit URL form:

```bash
brew tap yigitkonur/codex-worker https://github.com/yigitkonur/codex-worker
brew install yigitkonur/codex-worker/codex-worker
```

Optional dedicated tap mirror note:

- If you later want the shorter one-argument tap form, mirror `Formula/codex-worker.rb` into a dedicated `homebrew-...` repository and enable the optional mirror job.

Repository secrets:

- `NPM_TOKEN` is still required by the live npm release workflow
- No extra token is required for same-repository GitHub Release publishing or same-repository Homebrew formula updates; both use the built-in `GITHUB_TOKEN` with explicit workflow permissions.
- `HOMEBREW_TAP_TOKEN` is required only if `ENABLE_HOMEBREW_TAP_SYNC=true` for the optional cross-repository mirror.

Recommended rollout:

1. Merge the validation workflow and watch it pass on real GitHub-hosted runners.
2. Set `ENABLE_BINARY_RELEASE=true`.
3. Confirm a real release creates GitHub Release assets, checksums, and commits `Formula/codex-worker.rb` back to the publish branch.
4. Confirm `brew tap yigitkonur/codex-worker https://github.com/yigitkonur/codex-worker && brew update && brew upgrade yigitkonur/codex-worker/codex-worker` picks up the new formula revision.
5. If you want a dedicated tap mirror, create the `homebrew-...` repo, then set `ENABLE_HOMEBREW_TAP_SYNC=true`, `HOMEBREW_TAP_REPO`, and `HOMEBREW_TAP_TOKEN`.

## Verification

For binary-related changes, run:

```bash
npm run build
npm test
npm run smoke
npm run bun:compile
node --import tsx --test test/compiled-binary.test.ts
```
