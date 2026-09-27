# PR Scorer roadmap

What works today: paste a PR URL or number, or click Review on an open PR, get a CodeRabbit-style report (walkthrough, changes by cohort, effort estimate, six scores, blast radius, pre-merge checks, actionable comments, nitpicks, review details). Results cache in `scores/`. Dependency-free Node backend, React + Animate UI front-end, any OpenAI-compatible model. Sidebar, routing, open PR list, and Settings all work; the CodeRabbit nav items with nothing behind them are gone.

Everything below was removed from the UI because nothing was behind it. Ordered by value per hour. Each item says what to build and the laziest way to build it.

## 1. Post the review to GitHub (Automations, part 1)

The report only lives on localhost. Add a "Post to PR" button that runs `gh pr comment <url> --body-file` with a markdown render of the same two comments. Markdown version of `renderScore` is ~40 lines. This is the single feature that makes it CodeRabbit-like in practice.

## 2. Auto-review on open (Automations, part 2)

A `--watch` flag: every 5 minutes call `gh pr list`, score anything new, post the comment. No webhook, no server exposure. Upgrade path: GitHub webhook via a Cloudflare tunnel, or a GitHub Action that runs `node server.mjs --once <pr>` on `pull_request`.

## 3. Multiple repositories (Connected repositories)

`REPOS=owner/a,owner/b` env, sidebar lists them, home page tabs by repo. Open PR list loops `gh pr list -R`. Later: `gh repo list <org>` with a toggle per repo, persisted in `config.json`.

## 4. Path instructions (Scopes)

CodeRabbit's path-based review instructions. A `.pr-scorer.yml` in the target repo with `path: instructions` pairs, read via `gh api repos/:owner/:repo/contents/.pr-scorer.yml`, appended to the prompt for matching files. Our own CLAUDE.md rules (Mgr-only reads, tests under test-suite, docs with the change) are the first entries.

## 5. Real blast radius

Today it is files + lines + hotspot paths. Add import fan-out: clone or use a local checkout (`LOCAL_REPO` env), grep for importers of each changed module, count transitive dependents two levels deep. Report "N modules depend on the changed code".

## 6. Security scan (Security)

Run `gitleaks detect --no-git` on the diff text and `pnpm audit --json` when a lockfile changes. Render as a third bot comment with severity. Both tools are free and local.

## 7. Committable suggestions (Coding)

Ask the model for an optional `suggestion` field per finding containing replacement code. Render as a GitHub suggestion block when posting (item 1). Low effort once the prompt has room; quality depends on the model.

## 8. Search (Ctrl K)

Filter over cached reviews by title, file path, or finding text. Client-side over the JSON already on disk. Add when there are more than 30 reviews.

## 9. Slack

`SLACK_WEBHOOK_URL` env, one `fetch` after each review with title, verdict, quality, blast. Ten lines.

## 10. Environments

Named model profiles (`fast` = Ollama qwen coder, `deep` = MiniMax or Claude) selectable per review. Today: restart with different env vars. Add when switching becomes annoying.

## 11. Jev as a merge gate

Once a TypeSafe key exists: after the LLM review, ask Jev two or three yes/no policy questions (touches a domain table outside its Mgr, migration without docs change) and show them as pass/fail in Pre-merge checks. Jev cannot explain findings, so it complements the LLM rather than replacing it.

## Go-to-market (the actual goal)

The project only matters if strangers install it. Milestones, in order:

1. Public repo with a 30-second GIF in the README, `npx pr-scorer` one-liner, MIT license. Pilot customer: Debtops (first real repo, first testimonials).
2. GitHub Action variant (`uses: dharmeshgurnani/pr-scorer@v1`) so people can add it without running a server.
3. Submit to awesome lists once there are 3 external users and 1 release tag: awesome-code-review, awesome-github-actions, awesome-ai-devtools, awesome-selfhosted (needs a Dockerfile), awesome-llm-apps. Each list has a contributing.md with a format; follow it exactly, one PR per list, never batch.
4. Launch posts: Show HN, r/selfhosted, r/ExperiencedDevs, dev.to. Angle: "CodeRabbit-style review scores from any open model, runs on your laptop, no SaaS."

## Not planned

Billing, Account, per-page pagination, "Sync" buttons. These exist in CodeRabbit because it is a hosted product. A local tool has no use for them.

## Before open-sourcing

- Rename the bot and repo (anything but CodeRabbit; the look is fine, the trademark is not).
- Move the MiniMax key lookup behind a plain `LLM_API_KEY` requirement so strangers do not depend on the pi CLI.
- Add a `LICENSE` and a screenshot to the README.
