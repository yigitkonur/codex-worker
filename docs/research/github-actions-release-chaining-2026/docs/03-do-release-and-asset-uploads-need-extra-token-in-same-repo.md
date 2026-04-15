# Does creating or updating GitHub Releases and uploading release assets from Actions require an extra personal token when operating in the same repository?

**Scope:** Same-repository release creation and asset upload from GitHub Actions, not cross-repository publishing.
**Last updated:** 2026-04-15
**Confidence:** Medium-High — 4 primary sources; explicit support for same-repo `GITHUB_TOKEN` usage, with the final no-extra-token conclusion partly inferred across pages

## Answer

In the same repository, GitHub's documentation supports using the built-in `GITHUB_TOKEN` for Release creation and related API calls, provided the token has the necessary write permissions for the job. An extra PAT is not documented as required for same-repo Release creation or asset upload; GitHub only recommends another token when the needed permissions are unavailable to `GITHUB_TOKEN` or when you need access beyond the workflow's repository.

## Evidence

### Documented

- GitHub's `Use GITHUB_TOKEN for authentication in workflows` doc says you can use `GITHUB_TOKEN` for authenticated API calls, and you can adjust its permissions with the `permissions` key. Verified 2026-04-15.
- The same doc says you only need another credential when you require permissions "that aren't available in the `GITHUB_TOKEN`." In that case GitHub recommends a GitHub App token or PAT. Verified 2026-04-15.
- GitHub's `GITHUB_TOKEN` concept doc says the token is a GitHub App installation token scoped to the repository that contains the workflow. Verified 2026-04-15.
- The REST Releases doc says users with push access can create a release, and the API can create the tag if `tag_name` does not already exist by using `target_commitish`. Verified 2026-04-15.
- The REST Release Assets doc says upload uses the release's `upload_url` and still requires authentication to upload an asset. Verified 2026-04-15.
- GitHub's archived but official `actions/create-release` README explicitly states that the action can create a release using `${{ secrets.GITHUB_TOKEN }}` and that "you do not need to create your own token." Verified 2026-04-15.

### Inferred

- Because GitHub documents that `GITHUB_TOKEN` is repo-scoped, can make authenticated API calls, and only needs replacement when required permissions are unavailable, the same-repo Release path does not need an extra PAT by default.
- For a release workflow in the same repository, the practical requirement is to grant the job the needed write scopes, typically at least `contents: write`. The docs are explicit that you can tune `permissions`, but they do not present one single Actions page saying "release creation plus asset upload requires exactly X permission set."

## Caveats / Negative Signal

- If your repository or organization default token permissions are read-only, you must elevate the workflow or job `permissions`; otherwise the built-in token will authenticate but fail authorization.
- If your workflow needs permissions not available to `GITHUB_TOKEN`, GitHub's documented fallback is a GitHub App token or PAT.
- The strongest same-repo "no extra token needed" statement comes from GitHub's own archived `actions/create-release` repository. It is still first-party, but it is not the current mainline docs page.

## Sources

- [Use GITHUB_TOKEN for authentication in workflows](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token) — GitHub Docs — verified 2026-04-15 — authenticated API calls, permission tuning, and when to use another token
- [GITHUB_TOKEN](https://docs.github.com/en/actions/concepts/security/github_token) — GitHub Docs — verified 2026-04-15 — repo scoping of the built-in token
- [REST API endpoints for releases](https://docs.github.com/en/rest/releases/releases#create-a-release) — GitHub Docs — verified 2026-04-15 — release creation behavior and tag creation behavior
- [REST API endpoints for release assets](https://docs.github.com/en/rest/releases/assets#upload-a-release-asset) — GitHub Docs — verified 2026-04-15 — asset upload requires authentication and uses the release upload URL
- [actions/create-release README](https://github.com/actions/create-release/blob/main/README.md) — GitHub repository maintained by GitHub, archived — verified 2026-04-15 — explicit statement that built-in `GITHUB_TOKEN` is sufficient for release creation
