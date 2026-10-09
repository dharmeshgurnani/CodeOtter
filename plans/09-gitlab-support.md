# 09. GitLab (self-managed and gitlab.com)

Priority: P2 · Effort: L (3 to 5 days) · Type: feature

## Problem
The buyer who refuses to send code to a SaaS is on self-managed GitLab far more often than on Forgejo or
Gitea. Three forges are supported; the one with the market share is not.

## Lazy fix
Copy the Forgejo adapter shape exactly: `gitlab~group/project` IDs, `GITLAB_URL` and `GITLAB_TOKEN`, the
PocketBase `gitlab` OAuth provider (PocketBase ships it). Endpoint differences: merge requests not pulls,
`changes` for the diff, discussions for inline notes, `statuses` for the commit status. Subgroups put `/` in
the owner, so extend `OWNER_RE` and `REPO_RE` for the `gitlab~` prefix only.
Integration test: `scripts/test-forges.mjs --gitlab` against `gitlab/gitlab-ce` in Docker (about 3 min to boot).

## Done when
A GitLab MR gets scores, a review comment and one inline suggestion, and the forge test passes.

## Skip
Bitbucket. Nobody self-hosts it anymore.
