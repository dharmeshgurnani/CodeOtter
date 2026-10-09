# 10. Auto-review on PR open and push

Priority: P1 · Effort: S (2 hours) · Type: feature

## Problem
Triage runs automatically (`triageConfig().auto`), but the full review only runs from the UI or a `/review`
comment. Every competitor's pitch is that the review shows up unasked.

## Lazy fix
- One checkbox in Settings → Review: "Review every new or updated pull request" (`REVIEW_DEFAULTS.auto`).
- In the triage loop (`server.mjs:416`) and later the webhook handler (Plan 04): after `triagePr`, when `auto`
  is on, call `syncPrComments(await score(url, true, repo), repo, { postScores, postReview })`. Same call
  `/review` makes.
- Concurrency: one review at a time through a single promise chain.
  `// ponytail: serial reviews; a real queue when a team outgrows it`.
- Skip drafts and PRs carrying a `codeotter:skip` label. Two `if`s.

## Done when
Opening a PR on an onboarded repo produces a review comment with no human action.
