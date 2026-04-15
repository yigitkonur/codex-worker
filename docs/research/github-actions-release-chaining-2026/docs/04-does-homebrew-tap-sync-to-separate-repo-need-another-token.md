# Can a Homebrew tap sync to a separate repository use the built-in `GITHUB_TOKEN`, or does it require another token?

**Scope:** Writing to or otherwise automating against a separate Homebrew tap repository from a workflow running in another repository.
**Last updated:** 2026-04-15
**Confidence:** High — 3 primary sources; strong agreement

## Answer

It requires another token. GitHub documents that the built-in `GITHUB_TOKEN` is limited to the workflow's own repository, so a tap sync targeting a separate repository needs a different credential, typically a GitHub App installation token or a PAT.

## Evidence

### Documented

- GitHub's `GITHUB_TOKEN` concept doc says the token's permissions are limited to the repository that contains the workflow. Verified 2026-04-15.
- GitHub's GitHub App authentication doc says: the built-in `GITHUB_TOKEN` "can only access resources within the workflow's repository." If you need resources in another repository or organization, GitHub says to use a GitHub App. Verified 2026-04-15.
- The official `actions/checkout` README says `${{ github.token }}` is scoped to the current repository, and for a different private repository you need to provide your own PAT. Verified 2026-04-15.

### Inferred

- A Homebrew tap sync that commits to `owner/homebrew-tap` from `owner/main-repo` is cross-repository automation, so it is outside the built-in token's documented scope.
- For modern setups, a GitHub App installation token is the cleaner documented option than a long-lived PAT, because GitHub's own docs point to GitHub Apps for cross-repository access from Actions.

## Caveats / Negative Signal

- If the tap lives in the same repository, this conclusion changes; same-repo automation can use `GITHUB_TOKEN` if permissions are sufficient.
- `actions/checkout` explicitly calls out the private secondary-repository case. For a public tap repo, the read path may not need auth, but the write path still does, and `GITHUB_TOKEN` remains scoped to the source repository.
- GitHub's docs do not provide a Homebrew-specific page. The conclusion is based on GitHub's generic cross-repository token rules, which are directly applicable to tap-sync workflows.

## Sources

- [GITHUB_TOKEN](https://docs.github.com/en/actions/concepts/security/github_token) — GitHub Docs — verified 2026-04-15 — built-in token is limited to the workflow repository
- [Making authenticated API requests with a GitHub App in a GitHub Actions workflow](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/making-authenticated-api-requests-with-a-github-app-in-a-github-actions-workflow) — GitHub Docs — verified 2026-04-15 — GitHub App recommended for access to another repository or organization
- [actions/checkout README](https://github.com/actions/checkout/blob/main/README.md#checkout-multiple-repos-private) — GitHub repository maintained by GitHub — verified 2026-04-15 — `${{ github.token }}` is scoped to the current repository; separate private repo requires another token
