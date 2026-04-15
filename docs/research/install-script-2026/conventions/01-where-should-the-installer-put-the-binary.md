# Where should the installer put the binary?

**Scope:** Install location conventions for a shell installer on Linux and macOS, including root vs non-root behavior; not Windows package-manager strategy.
**Last updated:** 2026-04-15
**Confidence:** High — 4 independent sources; strong agreement

## Answer

For a direct shell installer, the best default is: install to `~/.local/bin` for non-root users and to `/usr/local/bin` only when explicitly running with `sudo` or as root. Do not write into `/usr/bin`.

## Evidence

- The Filesystem Hierarchy Standard says `/usr/local` is for software installed locally by the system administrator and that locally installed software "must be placed within `/usr/local` rather than `/usr`" unless it is replacing or upgrading software in `/usr`. It also defines `/usr/local/bin` as the directory for local binaries.  
  Source: [/usr/local : Local hierarchy](https://specifications.freedesktop.org/fhs/latest/usrLocal.html) — accessed 2026-04-15.

- The `rclone` installer is an example of an older root-oriented pattern: on macOS it installs to `/usr/local/bin`, but on Linux it writes directly to `/usr/bin`. That is widely compatible for root installs, but it is more invasive than current least-privilege norms and should not be copied for a modern user-mode installer.  
  Source: [rclone install.sh](https://rclone.org/install.sh) — accessed 2026-04-15.

- Bun's first-party installer goes the other direction: it installs into a user-owned directory under `~/.bun/bin`, creates that directory if needed, and updates shell startup files when `bun` is not yet on `PATH`. That is a strong first-party example of a non-root `curl | bash` flow.  
  Source: [bun.com/install](https://bun.com/install) and [Bun installation docs](https://bun.com/docs/installation) — accessed 2026-04-15.

- Inference from these sources: for a generic CLI that is not a language runtime, `~/.local/bin` is the better user-mode default than a tool-specific directory like `~/.bun/bin`, because it avoids owning yet another per-tool bin directory while keeping the install unprivileged. `/usr/local/bin` remains the right root-owned destination because the FHS explicitly reserves it for local binaries.

## Caveats / Negative Signal

- Some systems do not have `~/.local/bin` on `PATH` by default. A user-mode installer should detect that and print a shell-specific PATH hint instead of silently succeeding.
- On Apple Silicon Macs, package-manager users may expect `/opt/homebrew/bin`, but that is Homebrew-owned space and should not be written by a generic installer.
- Avoid `/usr/bin` unless the installer is intentionally replacing a system-managed binary; the FHS guidance cuts against that for local software.

## Sources

- [/usr/local : Local hierarchy](https://specifications.freedesktop.org/fhs/latest/usrLocal.html) — Filesystem Hierarchy Standard — accessed 2026-04-15 — canonical purpose of `/usr/local/bin`
- [rclone install.sh](https://rclone.org/install.sh) — rclone first-party installer — accessed 2026-04-15 — root-oriented install destinations
- [bun.com/install](https://bun.com/install) — Bun first-party installer — accessed 2026-04-15 — user-owned install destination
- [Bun installation docs](https://bun.com/docs/installation) — Bun Docs — accessed 2026-04-15 — official user-mode installation flow
