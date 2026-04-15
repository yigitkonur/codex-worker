# GitHub Actions release chaining and token behavior in 2026

## Document index

| File | Question answered | One-line summary |
|---|---|---|
| [docs/01-do-github-token-pushes-and-tags-trigger-other-workflows.md](./docs/01-do-github-token-pushes-and-tags-trigger-other-workflows.md) | Do `GITHUB_TOKEN`-caused pushes/tags trigger more workflows? | No, except for `workflow_dispatch` and `repository_dispatch`. |
| [docs/02-recommended-release-chaining-with-workflow-run-and-artifacts.md](./docs/02-recommended-release-chaining-with-workflow-run-and-artifacts.md) | What is GitHub's recommended chaining pattern? | Unprivileged workflow uploads artifacts; privileged `workflow_run` workflow downloads them and publishes. |
| [docs/03-do-release-and-asset-uploads-need-extra-token-in-same-repo.md](./docs/03-do-release-and-asset-uploads-need-extra-token-in-same-repo.md) | Is an extra PAT required for same-repo Releases/assets? | Usually no; built-in `GITHUB_TOKEN` is sufficient if it has the needed write permissions. |
| [docs/04-does-homebrew-tap-sync-to-separate-repo-need-another-token.md](./docs/04-does-homebrew-tap-sync-to-separate-repo-need-another-token.md) | Can cross-repo Homebrew tap sync use `GITHUB_TOKEN`? | No; cross-repo tap sync needs a GitHub App token or PAT. |

## Critical findings

- [`GITHUB_TOKEN` fan-out is blocked by design](./docs/01-do-github-token-pushes-and-tags-trigger-other-workflows.md): GitHub still documents in 2026 that `GITHUB_TOKEN`-caused events do not create new workflow runs, except `workflow_dispatch` and `repository_dispatch`.
- [`workflow_run` is the official privilege boundary](./docs/02-recommended-release-chaining-with-workflow-run-and-artifacts.md): GitHub explicitly says the downstream `workflow_run` workflow can access secrets and write tokens even if the upstream workflow could not.
- [Artifact handoff is documented and useful, but not trustless](./docs/02-recommended-release-chaining-with-workflow-run-and-artifacts.md): GitHub's own docs and security guidance show artifact download as the bridge, while warning that untrusted upstream data can poison privileged workflows.
- [Same-repo Release publishing does not inherently require a PAT](./docs/03-do-release-and-asset-uploads-need-extra-token-in-same-repo.md): the built-in `GITHUB_TOKEN` can make authenticated API calls in-repo, and GitHub only points you to another token when the required permissions are unavailable or you need cross-repo access.
- [Separate Homebrew tap sync is cross-repo automation, so the built-in token is insufficient](./docs/04-does-homebrew-tap-sync-to-separate-repo-need-another-token.md): GitHub's repo-scoping rules make another credential mandatory.

## Cross-file insights

- The clean design split is: same-repo publish can stay on `GITHUB_TOKEN`; cross-repo publish cannot.
- GitHub's recursion-prevention rule is the reason many release pipelines use `workflow_run` instead of trying to trigger release or publish workflows via a `GITHUB_TOKEN` push or tag.
- The main implementation risk is not "can GitHub chain this?" but "can the privileged phase trust the data coming from the unprivileged phase?" GitHub's security guidance says to treat that boundary carefully.
- The docs are explicit about behavior, but not always explicit about the exact minimum permission matrix for every release sub-step. For same-repo Release publishing, the conclusion is strong, but partly synthesized across docs rather than stated on one single page.

## Action items

1. Use an unprivileged build workflow that uploads release metadata and assets as artifacts.
2. Trigger a privileged publisher on `workflow_run`, and gate jobs on `github.event.workflow_run.conclusion == 'success'`.
3. Validate artifact names and contents before publish; do not trust upstream artifacts blindly.
4. For same-repo Release creation and asset upload, prefer `GITHUB_TOKEN` with explicit job-level permissions rather than adding a PAT by default.
5. For Homebrew tap sync to a different repository, use a GitHub App installation token first; use a PAT only if App setup is not practical.

## Coverage scope

This research covers GitHub-hosted documentation and GitHub-maintained repositories relevant to four concrete questions about workflow recursion, `workflow_run`, same-repo Release publishing, and cross-repo Homebrew tap sync as verified on 2026-04-15.

It does not cover:

- third-party release actions beyond GitHub-maintained examples
- GitHub Enterprise Server version-specific differences
- Homebrew formula authoring details outside GitHub authentication and workflow chaining behavior

## Source roll-up

- GitHub Docs pages: 8
- GitHub Blog posts: 1
- GitHub-maintained repository docs: 2
