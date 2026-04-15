# How should the installer detect Linux libc and macOS architecture?

**Scope:** Linux `glibc` vs `musl` routing, macOS arm64 vs x64 routing, and the edge cases visible in first-party Bun docs and installer code.
**Last updated:** 2026-04-15
**Confidence:** High — 6 independent sources; moderate-to-strong agreement

## Answer

The installer should detect platform in this order: OS, CPU architecture, then Linux libc family. For `codex-worker`, that means `darwin-arm64` vs `darwin-x64` on macOS, and `linux-{x64,arm64}` plus `-musl` variants on Linux; libc detection should not rely only on `/etc/alpine-release`.

## Evidence

- Bun's installation script uses `uname -ms` for OS and architecture routing, maps `Darwin arm64` to `darwin-aarch64`, `Darwin x86_64` to `darwin-x64`, and maps Linux arm64 and x64 similarly. That is the simplest stable OS/arch detection pattern to copy.  
  Source: [bun.com/install](https://bun.com/install), accessed 2026-04-15.

- Bun's installer then switches Linux targets to `-musl` only when `/etc/alpine-release` exists. That works for Alpine, but Bun's own docs also call out musl binaries for "Alpine Linux, Void Linux," which shows that `/etc/alpine-release` is narrower than the full documented musl audience.  
  Sources: [bun.com/install](https://bun.com/install), [Bun installation docs](https://bun.com/docs/installation) — accessed 2026-04-15.

- Bun's installation docs explicitly list separate musl downloads for `bun-linux-x64-musl`, `bun-linux-x64-musl-baseline`, and `bun-linux-aarch64-musl`, and say the install script automatically chooses the correct binary. The docs also use a glibc loader error example to tell users to try the musl binary. That supports a libc-aware installer instead of a generic Linux asset.  
  Source: [Bun installation docs](https://bun.com/docs/installation) — accessed 2026-04-15.

- Bun's executable docs list separate glibc and musl compile targets for Linux and show separate `darwin-x64` and `darwin-arm64` targets for macOS. They also warn that x64 builds have baseline and modern compatibility differences.  
  Source: [Single-file executable](https://bun.sh/docs/bundler/executables#supported-targets) — accessed 2026-04-15.

- Bun issue `#23910` is still open as of 2026-04-15 and documents that the `bun-linux-x64-musl` target is not fully static and still depends on musl runtime components. For this repo, that means the installer can route Alpine and other musl systems to `*-musl`, but the docs should not oversell those binaries as `FROM scratch` compatible.  
  Source: [`oven-sh/bun#23910`](https://github.com/oven-sh/bun/issues/23910) — opened 2025-10-21, still open on 2026-04-15.

- This repo already publishes the exact asset matrix an installer needs for platform routing: `linux-x64`, `linux-x64-baseline`, `linux-arm64`, `linux-x64-musl`, `linux-arm64-musl`, `darwin-x64`, and `darwin-arm64`.  
  Sources: [build-binary.mjs](/Users/yigitkonur/dev/cli-codex-worker/scripts/build-binary.mjs#L19), [binary-releases.md](/Users/yigitkonur/dev/cli-codex-worker/docs/distribution/binary-releases.md#L55) — repo source — accessed 2026-04-15.

## Caveats / Negative Signal

- Documented: Bun's first-party installer uses only `/etc/alpine-release` for musl detection.
- Inferred: For `codex-worker`, that is too narrow because this repo ships musl-specific assets and Bun's docs explicitly mention non-Alpine musl systems. A safer installer should check `/etc/alpine-release` first, then fall back to `ldd --version`, `getconf GNU_LIBC_VERSION`, or inspecting the ELF interpreter path before defaulting to glibc.
- macOS Rosetta is a real edge case. Bun's installer detects Rosetta and prefers arm64 when a translated x64 shell is running on Apple Silicon. That is worth copying if this repo wants the fastest Apple Silicon default.

## Sources

- [bun.com/install](https://bun.com/install) — Bun first-party install script — accessed 2026-04-15 — OS/arch routing, Alpine check, Rosetta handling
- [Bun installation docs](https://bun.com/docs/installation) — Bun Docs — accessed 2026-04-15 — musl download links, glibc-vs-musl guidance, CPU requirements
- [Single-file executable](https://bun.sh/docs/bundler/executables#supported-targets) — Bun Docs — accessed 2026-04-15 — compile target matrix
- [`oven-sh/bun#23910`](https://github.com/oven-sh/bun/issues/23910) — Bun issue tracker — 2025-10-21, accessed 2026-04-15 — musl target not fully static
- [build-binary.mjs](/Users/yigitkonur/dev/cli-codex-worker/scripts/build-binary.mjs#L19) — repo source — accessed 2026-04-15 — current release target matrix
- [binary-releases.md](/Users/yigitkonur/dev/cli-codex-worker/docs/distribution/binary-releases.md#L55) — repo source — accessed 2026-04-15 — current public asset names and musl note
