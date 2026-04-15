# Is `raw.githubusercontent.com/<repo>/main/...` a reasonable stable URL for an install script?

**Scope:** Whether a branch-based raw GitHub URL is an appropriate public installer entrypoint, and which GitHub-hosted alternatives are more stable.
**Last updated:** 2026-04-15
**Confidence:** High — 5 independent sources; strong agreement

## Answer

`raw/main` is reasonable only as a mutable "always latest bootstrap script" URL. It is not a stable or reproducible URL. For a GitHub-hosted stable URL, prefer a release asset such as `https://github.com/<owner>/<repo>/releases/latest/download/install.sh` for the live stable channel, and tag-specific release asset URLs for pinned installs.

## Evidence

- GitHub's file permalink docs say normal file views usually point at the current head of a branch and that the contents can change as new commits are made. They explicitly recommend using a commit ID for a permanent link because branch-based URLs are mutable. The same mutability applies to raw branch URLs.  
  Source: [Getting permanent links to files](https://docs.github.com/en/repositories/working-with-files/using-files/getting-permanent-links-to-files) — accessed 2026-04-15.

- A live `Get repository content` API response for `cli/cli` on 2026-04-15 returned a `download_url` of `https://raw.githubusercontent.com/cli/cli/trunk/README.md`, which shows GitHub's content-download URLs point at a branch name, not an immutable commit, when you fetch current repository contents. That confirms the mutability risk in practice.  
  Source: [`cli/cli` contents API response](https://api.github.com/repos/cli/cli/contents/README.md) — accessed 2026-04-15.

- GitHub's repository-contents docs say `download_url` values expire and are meant to be used only once. That makes the contents API unsuitable as the public stable installer URL, even though it is useful for obtaining a fresh ephemeral raw URL.  
  Source: [REST API endpoints for repository contents](https://docs.github.com/en/rest/repos/contents?apiVersion=2022-11-28) and its markdown form — accessed 2026-04-15.

- GitHub's release-linking docs provide a stable "latest asset" URL shape: `/releases/latest/download/<asset-name>`. That is a better long-lived public URL than `raw/main` when you want "latest stable installer" semantics.  
  Source: [Linking to releases](https://docs.github.com/en/repositories/releasing-projects-on-github/linking-to-releases) — accessed 2026-04-15.

- Inference from these sources: if this repo wants one canonical `curl | bash` command, GitHub Releases is the better anchor than `raw/main` because it lets the project control stable-channel semantics independently from every commit pushed to `main`.

## Caveats / Negative Signal

- `raw/main` is still acceptable for internal docs, nightly channels, or repos that intentionally want every `main` commit to become the next install behavior.
- A release-asset installer URL only works if `install.sh` is uploaded as an asset on each release.
- A commit-pinned raw URL is reproducible, but it does not give a stable moving "latest stable" channel.

## Sources

- [Getting permanent links to files](https://docs.github.com/en/repositories/working-with-files/using-files/getting-permanent-links-to-files) — GitHub Docs — accessed 2026-04-15 — branch URLs are mutable; commit URLs are permanent
- [`cli/cli` contents API response](https://api.github.com/repos/cli/cli/contents/README.md) — GitHub API — accessed 2026-04-15 — live example of branch-based raw URL
- [REST API endpoints for repository contents](https://docs.github.com/en/rest/repos/contents?apiVersion=2022-11-28) — GitHub Docs — accessed 2026-04-15 — ephemeral `download_url` behavior
- [GitHub docs markdown for repository contents](https://docs.github.com/api/article/body?pathname=/en/rest/repos/contents&apiVersion=2022-11-28) — GitHub Docs — accessed 2026-04-15 — exact wording that download URLs expire and are single-use
- [Linking to releases](https://docs.github.com/en/repositories/releasing-projects-on-github/linking-to-releases) — GitHub Docs — accessed 2026-04-15 — stable latest-release asset path
