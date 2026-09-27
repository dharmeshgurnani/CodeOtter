# Changelog

## Unreleased

- System One models: a second engine next to the language model. TypeSafe Jev scores pull requests from fixed rubrics and answers merge gates (security, complexity, tests, docs, scope, repository guidelines), shown under Pre-merge checks. Runs in parallel with the language model; either engine works alone. Reachable directly from TypeSafe or through OpenRouter.
- Removed the "Review pull request" header button; open pull requests are reviewed from their repository page.
- The UI no longer names the storage backend.
- Model fields are picklists filled from each provider's model-list API (Anthropic, OpenAI-compatible, OpenRouter, TypeSafe), with static suggestions until a key is saved and a text box for custom endpoints.

## 0.1.0 (2026-09-27)

First release.

- Pull request reviews with quality, blast radius, risk, tests, readability and hygiene scores, findings and a file walkthrough, from any OpenAI-compatible model or Anthropic.
- PocketBase storage, single Docker image, Compose file.
- Multiple repositories grouped by organization; every page scoped to the active organization.
- Repository review guidelines auto-detected from `AGENTS.md` / `CLAUDE.md`.
- GitHub sign-in with one-click GitHub App creation; owner and admin roles; Admin section for platform settings.
- JSON-driven settings and dashboards rendered by one generic renderer; Animate UI sidebar, dialogs and menus.
