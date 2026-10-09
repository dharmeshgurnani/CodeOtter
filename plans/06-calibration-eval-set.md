# 06. Prove "calibrated": a public eval set and a number in the README

Priority: P1 · Effort: M (2 days, mostly collecting PRs) · Type: feature

## Problem
README claims calibrated scores and deterministic gates. Nothing in the repo measures it. ROADMAP has
"validate System One triage on past PRs" unchecked. Without a number it is a claim, and claims do not get
Show HN upvotes or enterprise pilots.

## Lazy fix
- `eval/prs.json`: 50 to 100 merged PRs from popular public repos with a known outcome
  (`reverted`, `bugfix-followup-within-7d`, `clean`). Collect with `gh search prs` and `gh api .../commits`.
- `scripts/eval.mjs`: runs `score()` on each with the configured models, writes `eval/results-<model>.json`,
  prints AUC of `correctness_risk` against outcome, precision and recall of the `tests` and `security` gates,
  and mean absolute error of the triage risk score. Plain Node, no framework.
- README: one table, Jev vs Clef vs Kev 4B on N PRs, dated. Refresh each release.

## Done when
`node scripts/eval.mjs --model clef` prints an AUC and the README table holds real numbers.

## Skip
A hosted leaderboard. A JSON file and a table is the whole product here.
