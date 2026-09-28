# Changelog

## Unreleased

- Rebranded project to **CodeOtter** (`codeotter`) with a `DESIGN.md` token specification. The mascot is the otter with the score card (`assets/banners/hero-score-card.png`); the candidate mascot sheets, the `brand-showcase.html` exploration and the unused banner variants were removed from the repository. `assets/` now holds only what the README uses.
- System One models: a second engine next to the language model. TypeSafe Jev scores pull requests from fixed rubrics and answers merge gates (security, complexity, tests, docs, scope, repository guidelines), shown under Pre-merge checks. Runs in parallel with the language model; either engine works alone. Reachable directly from TypeSafe or through OpenRouter.
- Removed the "Review pull request" header button; open pull requests are reviewed from their repository page.
- The UI no longer names the storage backend.
- Local models moved to the Admin section (platform-wide; each organization still picks its own provider) and laid out like Model provider: a Language models section and a System One models section, both used together.
- Microsoft CodeReviewer (and its comment fine-tune) as a third offline language option: a CodeT5 model that writes one review comment per diff hunk through a Python sidecar; needs a System One model for scores. Requests are no longer cut at Node's default 5-minute limit, so cold local sidecars can finish long reviews.
- Two offline language models, Qwen2.5-Coder 1.5B and 7B, served by llama.cpp's `llama-server` as a second sidecar; a review can run fully offline with a local language model and a local System One model.
- Two offline System One models, run locally through the ggmlc `laya` runtime: Laya typed-decisions (455 MB) and Kev 0.8B (828 MB). A Admin → Local models page lists downloaded and available models with Download / Use / Delete and download progress; nothing downloads by itself. Plus a custom `/v1/systemone` endpoint provider for self-hosted models.
- With a System One model configured, every score comes from it: the five review scores and blast radius from rubrics, plus title and description checks as gates. The language model is then not asked for scores.
- Model fields are picklists filled from each provider's model-list API (Anthropic, OpenAI-compatible, OpenRouter, TypeSafe), with static suggestions until a key is saved and a text box for custom endpoints.

## 0.1.0 (2026-09-27)

First release.

- Pull request reviews with quality, blast radius, risk, tests, readability and hygiene scores, findings and a file walkthrough, from any OpenAI-compatible model or Anthropic.
- PocketBase storage, single Docker image, Compose file.
- Multiple repositories grouped by organization; every page scoped to the active organization.
- Repository review guidelines auto-detected from `AGENTS.md` / `CLAUDE.md`.
- GitHub sign-in with one-click GitHub App creation; owner and admin roles; Admin section for platform settings.
- JSON-driven settings and dashboards rendered by one generic renderer; Animate UI sidebar, dialogs and menus.
