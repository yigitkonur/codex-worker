# How should a GitHub Releases installer detect the latest stable release?

**Scope:** Stable-channel latest-release lookup for public GitHub repositories, including API semantics, rate limits, and the edge cases that matter for a shell installer.
**Last updated:** 2026-04-15
**Confidence:** High — 5 independent sources; strong agreement

## Answer

For a stable channel, the installer should use `GET /repos/{owner}/{repo}/releases/latest` with the GitHub REST API, then select the matching asset from that response. Do not derive "latest" from HTML scraping or from listing all releases unless you explicitly need prereleases or custom channel logic.

## Evidence

- GitHub's REST docs define the latest release precisely: it is "the most recent non-prerelease, non-draft release, sorted by the `created_at` attribute." The same section notes that `created_at` is the date of the commit used for the release, not the draft or publish time. This matters if a project backfills or republishes tags; "latest" is not necessarily "most recently published."  
  Source: [REST API endpoints for releases](https://docs.github.com/en/rest/releases/releases?apiVersion=2022-11-28#get-the-latest-release) and the docs markdown endpoint for that page, accessed 2026-04-15.

- The same GitHub docs say drafts and prereleases cannot be set as latest. That means `releases/latest` is the right endpoint only for a stable channel. If this repo ever adds prerelease installer channels, the installer should switch to explicit tag lookup such as `GET /repos/{owner}/{repo}/releases/tags/{tag}` or a filtered `List releases` flow instead of reusing `latest`.  
  Source: [REST API endpoints for releases](https://docs.github.com/en/rest/releases/releases?apiVersion=2022-11-28), accessed 2026-04-15.

- GitHub's rate-limit docs say unauthenticated REST requests for public data are limited to `60 requests per hour` per IP, while authenticated user requests get `5,000 requests per hour`. For a `curl | bash` installer, that argues for exactly one API call for stable lookup, not a multi-call sequence.  
  Source: [Rate limits for the REST API](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api), accessed 2026-04-15.

- GitHub's release-linking docs provide a stable latest-release asset URL form for manually uploaded assets: `https://github.com/<owner>/<repo>/releases/latest/download/<asset-name>`. That is useful for direct asset downloads, but it does not solve platform detection by itself; the installer still needs API-based asset selection unless each platform has its own well-known URL.  
  Source: [Linking to releases](https://docs.github.com/en/repositories/releasing-projects-on-github/linking-to-releases), accessed 2026-04-15.

- A live public API response from `cli/cli` on 2026-04-15 shows the latest-release response includes `tag_name`, `draft`, `prerelease`, and per-asset metadata including `name`, `browser_download_url`, and `digest`. That confirms a single API call is enough to choose a stable release asset and extract a server-published checksum when present.  
  Source: [`cli/cli` latest release API response](https://api.github.com/repos/cli/cli/releases/latest), accessed 2026-04-15.

## Caveats / Negative Signal

- If a project wants prerelease or beta channels, `releases/latest` is the wrong primitive because GitHub excludes prereleases and drafts by design.
- Because GitHub sorts stable "latest" by `created_at`, repositories with unusual tag workflows can produce results that differ from "most recently published."
- Anonymous installer traffic can hit the `60/hour/IP` limit in CI, NATed offices, or popular container images. A well-behaved installer should handle `403` or `429` cleanly and surface a fallback command using an explicit tag when possible.

## Sources

- [REST API endpoints for releases](https://docs.github.com/en/rest/releases/releases?apiVersion=2022-11-28#get-the-latest-release) — GitHub Docs — accessed 2026-04-15 — canonical semantics for `releases/latest`
- [GitHub docs markdown for releases](https://docs.github.com/api/article/body?pathname=/en/rest/releases/releases&apiVersion=2022-11-28) — GitHub Docs — accessed 2026-04-15 — exact wording for latest/draft/prerelease behavior
- [Rate limits for the REST API](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) — GitHub Docs — accessed 2026-04-15 — unauthenticated and authenticated rate limits
- [Linking to releases](https://docs.github.com/en/repositories/releasing-projects-on-github/linking-to-releases) — GitHub Docs — accessed 2026-04-15 — `releases/latest/download/<asset>`
- [cli/cli latest release API response](https://api.github.com/repos/cli/cli/releases/latest) — GitHub API — accessed 2026-04-15 — live example of returned fields
