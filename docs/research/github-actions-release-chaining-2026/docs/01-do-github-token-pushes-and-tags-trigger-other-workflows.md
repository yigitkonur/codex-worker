# Do workflows triggered by `GITHUB_TOKEN`-created pushes or tags start other workflows?

**Scope:** Whether GitHub Actions events caused by the built-in repository `GITHUB_TOKEN` fan out into new workflow runs, specifically for pushes and tag creation in the same repository.
**Last updated:** 2026-04-15
**Confidence:** High — 3 independent primary sources; strong agreement

## Answer

No. GitHub documents that events caused by the repository `GITHUB_TOKEN` do not start new workflow runs, except for `workflow_dispatch` and `repository_dispatch`. That covers pushes and tag-related events created by a workflow using the built-in token.

## Evidence

### Documented

- GitHub's `Triggering a workflow` doc says: events triggered by the repository `GITHUB_TOKEN`, except `workflow_dispatch` and `repository_dispatch`, "will not create a new workflow run." It gives `push` as the concrete example: if a workflow pushes code with `GITHUB_TOKEN`, a new `push` workflow does not run. Verified 2026-04-15.
- GitHub's `GITHUB_TOKEN` concept doc repeats the same rule: events triggered by `GITHUB_TOKEN`, except `workflow_dispatch` and `repository_dispatch`, do not create new workflow runs, and specifically says a workflow push using `GITHUB_TOKEN` will not trigger another workflow. Verified 2026-04-15.
- GitHub's event reference defines tag creation as workflow-triggering repository activity (`create` for creating a Git reference, and `push` can target tags when `tags` filters are configured). Verified 2026-04-15.

### Inferred

- GitHub does not separately carve out an exception for tags created with `GITHUB_TOKEN`. Because the documented rule is event-wide and the only listed exceptions are `workflow_dispatch` and `repository_dispatch`, a tag push or tag creation done with `GITHUB_TOKEN` should also not fan out into new workflow runs.

## Caveats / Negative Signal

- If you use a GitHub App installation token or a personal access token instead of `GITHUB_TOKEN`, GitHub documents that you can trigger downstream workflows.
- `workflow_dispatch` and `repository_dispatch` are explicit exceptions and can still start workflows.
- The docs do not expose a visible page-level "last updated" timestamp, so the verification date above is the access date, not a GitHub-published modification date.

## Sources

- [Triggering a workflow](https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/triggering-a-workflow) — GitHub Docs — verified 2026-04-15 — explicit rule for `GITHUB_TOKEN` recursion prevention
- [GITHUB_TOKEN](https://docs.github.com/en/actions/concepts/security/github_token) — GitHub Docs — verified 2026-04-15 — same rule in the token reference
- [Events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows) — GitHub Docs — verified 2026-04-15 — event semantics for `push` and Git reference creation
