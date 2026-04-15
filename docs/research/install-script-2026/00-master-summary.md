# GitHub Releases Shell Installer Research for `codex-worker`

## Document Index

| File | What it answers |
|---|---|
| [releases/01-how-should-latest-release-detection-work.md](./releases/01-how-should-latest-release-detection-work.md) | Which GitHub API endpoint should drive stable-channel latest detection, and what edge cases come with it |
| [integrity/01-how-should-installer-download-and-verify-assets.md](./integrity/01-how-should-installer-download-and-verify-assets.md) | How the installer should download assets and verify `sha256` in 2026 |
| [platform/01-how-should-installer-detect-linux-libc-and-macos-arch.md](./platform/01-how-should-installer-detect-linux-libc-and-macos-arch.md) | How to map Linux `glibc` vs `musl` and macOS `arm64` vs `x64` to current `codex-worker` assets |
| [conventions/01-where-should-the-installer-put-the-binary.md](./conventions/01-where-should-the-installer-put-the-binary.md) | Where a shell installer should place the binary for root and non-root installs |
| [urls/01-is-github-raw-main-a-stable-installer-url.md](./urls/01-is-github-raw-main-a-stable-installer-url.md) | Whether `raw/main` is a stable install-script URL and what to use instead |
| [bun/01-which-bun-x64-target-should-codex-worker-default-to.md](./bun/01-which-bun-x64-target-should-codex-worker-default-to.md) | Which Bun x64 target should be the default for this repo and when baseline should be used |

## Critical Findings

1. Latest stable lookup should use GitHub's `releases/latest` REST endpoint, not release-page scraping and not list-all-releases parsing for the stable channel. See [releases/01-how-should-latest-release-detection-work.md](./releases/01-how-should-latest-release-detection-work.md).
2. GitHub now exposes per-asset `digest` values in release API responses, and this repo already uploads `.sha256` artifacts, so `codex-worker` should verify checksums before install and fail closed on mismatch. See [integrity/01-how-should-installer-download-and-verify-assets.md](./integrity/01-how-should-installer-download-and-verify-assets.md).
3. This repo's installer should route among `linux-x64`, `linux-x64-baseline`, `linux-arm64`, `linux-x64-musl`, `linux-arm64-musl`, `darwin-x64`, and `darwin-arm64`, with Linux libc detection that goes beyond `/etc/alpine-release`. See [platform/01-how-should-installer-detect-linux-libc-and-macos-arch.md](./platform/01-how-should-installer-detect-linux-libc-and-macos-arch.md).
4. `raw.githubusercontent.com/.../main/...` is mutable and not a stable public installer URL. A better GitHub-hosted stable entrypoint is `releases/latest/download/install.sh`, with tag-specific release asset URLs for pinned installs. See [urls/01-is-github-raw-main-a-stable-installer-url.md](./urls/01-is-github-raw-main-a-stable-installer-url.md).
5. For `codex-worker`, the main Linux x64 build should remain the default; `linux-x64-baseline` is a compatibility fallback for older CPUs or `Illegal instruction` reports, not the standard path. See [bun/01-which-bun-x64-target-should-codex-worker-default-to.md](./bun/01-which-bun-x64-target-should-codex-worker-default-to.md).
6. Install destinations should be least-privilege by default: `~/.local/bin` for user installs, `/usr/local/bin` only for root installs. See [conventions/01-where-should-the-installer-put-the-binary.md](./conventions/01-where-should-the-installer-put-the-binary.md).

## Cross-File Insights

- GitHub Releases is now strong enough to be the installer control plane by itself: one API call can identify the stable release, pick a platform asset, and often provide a `sha256` digest directly. That reduces the need for separate metadata hosting.
- The main place where first-party examples are still weaker than the repo should be is integrity and libc detection. `rclone` is simpler but skips checksum verification; Bun handles platform routing well but uses a narrow musl heuristic. `codex-worker` can surpass both without adding much installer complexity.
- The repo is already structurally prepared for this installer design. The published asset matrix matches the needed routing logic, and the release workflow already emits `.sha256` assets. The missing piece is the installer implementation and the public URL choice.
- `raw/main` and `releases/latest/download/install.sh` are different channels. The first tracks branch head; the second tracks stable release state. The repo should choose one deliberately instead of treating them as equivalent.

## Action Items

1. Publish an `install.sh` as a release asset on every GitHub Release and document `curl -fsSL https://github.com/<owner>/<repo>/releases/latest/download/install.sh | bash` as the stable GitHub-hosted entrypoint.
2. In that installer, call `GET /repos/<owner>/<repo>/releases/latest` once, select the asset by OS/arch/libc, and use the response's `digest` or the matching `.sha256` asset to verify before installation.
3. Default to `codex-worker-linux-x64` on Linux x64, but auto-select `codex-worker-linux-x64-baseline` when AVX2 is absent or clearly advise it after `Illegal instruction` failures.
4. Use `~/.local/bin` for user installs and `/usr/local/bin` only for root installs; print PATH guidance when the destination directory is not already on `PATH`.
5. Implement libc detection with a layered strategy: explicit Alpine file check first, then `ldd`/`getconf`/ELF-interpreter fallback, then glibc as the last default.
6. Keep Bun pinned in release automation and treat Bun version bumps as explicit verification events, not routine dependency churn.

## Coverage Scope

This research covers:
- GitHub Releases latest-release detection
- GitHub-hosted installer URL choices
- Release-asset checksum verification
- Linux `musl` vs `glibc` and macOS architecture routing
- Bun x64 baseline guidance relevant to this repo's assets
- Install directory conventions for shell installers on Linux and macOS

This research does not cover:
- GPG or Sigstore signing rollout details
- macOS notarization or codesigning design for `codex-worker`
- Windows package-manager onboarding (`winget`, Scoop, Chocolatey)
- Self-update logic inside the binary

## Source Roll-Up

- GitHub Docs / GitHub API: 10
- Bun Docs / Bun first-party installer: 4
- Bun issue tracker: 3
- Established installer examples: 2
- Repo-local sources: 5
