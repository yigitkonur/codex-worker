# How should a GitHub Releases installer download and verify binaries?

**Scope:** Release-asset selection, `sha256` verification, and the practical integrity features GitHub exposes today; not a full signing or notarization design.
**Last updated:** 2026-04-15
**Confidence:** High — 6 independent sources; strong agreement

## Answer

The installer should download the release asset selected from the latest-release API response, verify `sha256` before install, and fail closed on checksum mismatch. For this repo, the cleanest pattern is: fetch `releases/latest`, choose the platform asset plus its `.sha256` companion, verify locally, then `chmod +x` and move into place.

## Evidence

- GitHub's release-asset docs expose three fields that matter directly to installers: `name`, `browser_download_url`, and `digest`. The docs describe `digest` as a first-class response field, so a shell installer can prefer the API-provided digest when present instead of scraping checksum text.  
  Source: [REST API endpoints for release assets](https://docs.github.com/en/rest/releases/assets?apiVersion=2022-11-28) and its markdown form, accessed 2026-04-15.

- A live `cli/cli` latest-release response on 2026-04-15 shows GitHub currently returns per-asset `digest` values in the form `sha256:<hex>`, alongside `browser_download_url`. That is current, real-world confirmation that GitHub Releases can now publish server-side digests to installers.  
  Source: [`cli/cli` latest release API response](https://api.github.com/repos/cli/cli/releases/latest), accessed 2026-04-15.

- GitHub's release-asset docs also note that asset filenames with special characters or leading/trailing periods may be renamed on upload, and that uploading the same filename again requires deleting the old asset first. For installers, that means asset selection must be exact and should match by canonical release filename, not by a loose substring.  
  Source: [REST API endpoints for release assets](https://docs.github.com/en/rest/releases/assets?apiVersion=2022-11-28), accessed 2026-04-15.

- GitHub's release-linking docs document the `releases/latest/download/<asset-name>` path for manually uploaded assets. That supports stable, per-asset direct download URLs, but it does not replace checksum verification.  
  Source: [Linking to releases](https://docs.github.com/en/repositories/releasing-projects-on-github/linking-to-releases), accessed 2026-04-15.

- The `rclone` installer is an established example of the older pattern: it downloads the current archive and installs it, but it does not perform a `sha256` verification step in the script itself. That makes it a useful compatibility reference, not the integrity bar to copy in 2026.  
  Source: [rclone install.sh](https://rclone.org/install.sh), accessed 2026-04-15.

- This repo's current release workflow already uploads everything under `dist/release/*` to the GitHub Release, and the shared bundle stage consumes `.sha256` files such as `codex-worker-darwin-x64.sha256` and `codex-worker-linux-x64.sha256`. That means the repo is already structurally aligned with checksum-first installers.  
  Sources: [release-binaries.yml](/Users/yigitkonur/dev/cli-codex-worker/.github/workflows/release-binaries.yml#L88), [binary-distribution-common.yml](/Users/yigitkonur/dev/cli-codex-worker/.github/workflows/binary-distribution-common.yml#L158) — repo source — accessed 2026-04-15.

## Caveats / Negative Signal

- `digest` is documented and visible in live API responses, but installers should still support a `.sha256` fallback because older releases may predate this field or third-party mirrors may not expose it consistently.
- `sha256` verifies transport integrity and release consistency, but it is not a full provenance story by itself. If this repo later needs stronger supply-chain guarantees, add signed checksums or release attestation separately.
- Directly trusting `browser_download_url` without verifying either `digest` or a checksum file is weaker than current GitHub capabilities justify.

## Sources

- [REST API endpoints for release assets](https://docs.github.com/en/rest/releases/assets?apiVersion=2022-11-28) — GitHub Docs — accessed 2026-04-15 — asset fields and upload edge cases
- [GitHub docs markdown for release assets](https://docs.github.com/api/article/body?pathname=/en/rest/releases/assets&apiVersion=2022-11-28) — GitHub Docs — accessed 2026-04-15 — exact `digest` and `browser_download_url` field names
- [cli/cli latest release API response](https://api.github.com/repos/cli/cli/releases/latest) — GitHub API — accessed 2026-04-15 — live example with `digest`
- [Linking to releases](https://docs.github.com/en/repositories/releasing-projects-on-github/linking-to-releases) — GitHub Docs — accessed 2026-04-15 — stable latest-download path
- [rclone install.sh](https://rclone.org/install.sh) — rclone first-party installer — accessed 2026-04-15 — established installer example without checksum verification
- [release-binaries.yml](/Users/yigitkonur/dev/cli-codex-worker/.github/workflows/release-binaries.yml#L88) — repo source — accessed 2026-04-15 — current release upload behavior
- [binary-distribution-common.yml](/Users/yigitkonur/dev/cli-codex-worker/.github/workflows/binary-distribution-common.yml#L158) — repo source — accessed 2026-04-15 — current `.sha256` generation/consumption
