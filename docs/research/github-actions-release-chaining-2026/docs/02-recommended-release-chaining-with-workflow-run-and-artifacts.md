# What is the documented GitHub pattern for chaining an unprivileged release-prep workflow to a privileged publisher with `workflow_run` and artifacts?

**Scope:** Official GitHub guidance for splitting an unprivileged workflow from a later privileged workflow, and the documented artifact handoff pattern between them.
**Last updated:** 2026-04-15
**Confidence:** High — 3 independent primary sources; strong agreement

## Answer

GitHub's documented pattern is: run the first workflow with limited privileges, upload the data needed by the privileged phase as artifacts, then trigger a second workflow on `workflow_run` and have it download those artifacts before performing the privileged action. GitHub explicitly says the `workflow_run`-started workflow can access secrets and write tokens even when the previous workflow could not.

## Evidence

### Documented

- The `workflow_run` section of `Events that trigger workflows` says the workflow started by `workflow_run` "is able to access secrets and write tokens, even if the previous workflow was not." Verified 2026-04-15.
- The same doc provides the canonical pattern: one workflow uploads data as an artifact; a second workflow triggered by `workflow_run` uses `github.event.workflow_run.id` plus the REST API to list artifacts, download the matching artifact, unzip it, and then perform a privileged action. Verified 2026-04-15.
- GitHub warns that running untrusted code on `workflow_run` can cause cache poisoning or unintended access to write privileges or secrets. Verified 2026-04-15.
- GitHub's security blog post on securing Actions describes privileged workflows activated by `workflow_run` as a security boundary: the unprivileged workflow runs checks first, then passes information to the privileged workflow. Published 2024-05-02; verified 2026-04-15.

### Inferred

- For a release pipeline, the same pattern maps cleanly to: unprivileged build/test workflow uploads release metadata and built artifacts; privileged publisher workflow runs on `workflow_run`, verifies the upstream result, downloads artifacts, and then creates the Release and uploads assets.
- Because GitHub explicitly treats artifacts from the unprivileged workflow as potentially untrusted, a safe publisher should validate artifact names, expected checksums, and upstream conclusion before publishing.

## Caveats / Negative Signal

- GitHub documents a hard limit: `workflow_run` cannot chain more than three levels deep.
- A `workflow_run` workflow triggers regardless of the previous workflow's conclusion unless you add an `if: ${{ github.event.workflow_run.conclusion == 'success' }}` guard.
- Artifact handoff is powerful but risky. GitHub's own security guidance treats upstream artifacts as untrusted input if the upstream workflow could be influenced by an attacker.

## Sources

- [Events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run) — GitHub Docs — verified 2026-04-15 — official `workflow_run` semantics, privilege model, and artifact example
- [Storing workflow data as artifacts](https://docs.github.com/en/actions/using-workflows/storing-workflow-data-as-artifacts) — GitHub Docs — verified 2026-04-15 — artifact mechanism referenced by the handoff pattern
- [How to secure your GitHub Actions workflows with CodeQL](https://github.blog/security/application-security/how-to-secure-your-github-actions-workflows-with-codeql/) — GitHub Blog — 2024-05-02 — security framing for `workflow_run` privilege separation and artifact trust boundaries
