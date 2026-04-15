# Which Bun x64 target should `codex-worker` default to, and when should it fall back to baseline?

**Scope:** Bun x64 CPU-baseline guidance as of 2026-04-15, including repo-specific recommendations for `codex-worker`'s published assets.
**Last updated:** 2026-04-15
**Confidence:** High — 6 independent sources; strong agreement

## Answer

`codex-worker` should keep the normal x64 builds as the default and fall back to `linux-x64-baseline` only when the user is on an older CPU or reports `Illegal instruction`. For this repo, the installer should default to `codex-worker-linux-x64`, retry or advise `codex-worker-linux-x64-baseline` on failure, and keep the Bun version pinned in release automation.

## Evidence

- Bun's executable docs say x64 builds use SIMD optimizations that require a modern CPU with AVX2 instructions, and say the `-baseline` build exists for users who see `Illegal instruction` errors. The same docs explicitly describe the compatibility tradeoff: modern is faster, baseline is more compatible.  
  Source: [Single-file executable](https://bun.sh/docs/bundler/executables#supported-targets) — accessed 2026-04-15.

- Bun's installation docs go further and spell out the CPU baselines: standard x64 binaries target Haswell or newer on Intel and Excavator or newer on AMD; `x64-baseline` targets Nehalem on Intel and Bulldozer on AMD. They also warn that baseline builds are slower and should be used only if the user encounters an `Illegal Instruction` error.  
  Source: [Bun installation docs](https://bun.com/docs/installation) — accessed 2026-04-15.

- Bun's own install script uses AVX2 detection on Linux x64 and x64 macOS to choose the baseline build automatically when AVX2 support is absent. That is first-party confirmation that baseline selection is meant as a compatibility fallback, not the mainline path.  
  Source: [bun.com/install](https://bun.com/install) — accessed 2026-04-15.

- Bun issue `#29270` documents a real compile regression in Bun `1.3.12` for `bun-darwin-arm64`; a Bun collaborator identified the root cause and the issue was closed on 2026-04-14. That is a current reminder not to float Bun versions casually in release automation for compiled binaries.  
  Sources: [`oven-sh/bun#29270`](https://github.com/oven-sh/bun/issues/29270), [`oven-sh/bun#29270 (comment)`](https://github.com/oven-sh/bun/issues/29270#issuecomment-4238635480) — 2026-04-13 to 2026-04-14.

- This repo already publishes both `linux-x64` and `linux-x64-baseline`, and its release docs already describe baseline as the build for older x86_64 CPUs that cannot run the default Bun Linux target.  
  Sources: [build-binary.mjs](/Users/yigitkonur/dev/cli-codex-worker/scripts/build-binary.mjs#L19), [binary-releases.md](/Users/yigitkonur/dev/cli-codex-worker/docs/distribution/binary-releases.md#L70) — repo source — accessed 2026-04-15.

- This repo also pins Bun `1.3.11` in release documentation and keeps Windows `--bytecode` off due to a verified repo-specific compile issue. That existing conservatism is aligned with the upstream regression evidence and should extend to installer messaging.  
  Sources: [binary-releases.md](/Users/yigitkonur/dev/cli-codex-worker/docs/distribution/binary-releases.md#L70), [build-binary.mjs](/Users/yigitkonur/dev/cli-codex-worker/scripts/build-binary.mjs#L70) — repo source — accessed 2026-04-15.

## Caveats / Negative Signal

- Documented: Bun supports baseline x64 compatibility targets.
- Documented: baseline is slower and intended as a fallback.
- Inferred for this repo: the installer should not auto-pick baseline by default on Linux unless AVX2 detection clearly fails, because the normal build is the preferred performance path and the repo already exposes baseline as a named compatibility asset.

## Sources

- [Single-file executable](https://bun.sh/docs/bundler/executables#supported-targets) — Bun Docs — accessed 2026-04-15 — x64 AVX2 requirement and baseline guidance
- [Bun installation docs](https://bun.com/docs/installation) — Bun Docs — accessed 2026-04-15 — Haswell/Nehalem CPU baseline details
- [bun.com/install](https://bun.com/install) — Bun first-party installer — accessed 2026-04-15 — AVX2-based baseline routing
- [`oven-sh/bun#29270`](https://github.com/oven-sh/bun/issues/29270) — Bun issue tracker — opened 2026-04-13, closed 2026-04-14 — recent darwin-arm64 compile regression
- [`oven-sh/bun#29270 (comment)`](https://github.com/oven-sh/bun/issues/29270#issuecomment-4238635480) — Bun collaborator comment — 2026-04-13 — root cause and fix PR
- [build-binary.mjs](/Users/yigitkonur/dev/cli-codex-worker/scripts/build-binary.mjs#L19) — repo source — accessed 2026-04-15 — published x64 and x64-baseline targets
- [binary-releases.md](/Users/yigitkonur/dev/cli-codex-worker/docs/distribution/binary-releases.md#L70) — repo source — accessed 2026-04-15 — pinned Bun and baseline guidance
