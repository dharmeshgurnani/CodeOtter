# Changelog

## Unreleased
- `install.sh` and `start.sh` moved to `bin/`; `pnpm co:install` and `pnpm co:start` run them. The installer URL is now `.../main/bin/install.sh` (the Azure button and Linode StackScript follow). `start.sh` now works from any checkout, not only the Docker image.
- **CLI, TUI and MCP reviews use the server engines** (`reviewDiff` in `core/server.mjs`): a configured System One model owns every score and gate, the language model writes the prose and is asked for scores only when no System One model exists, and findings go through the self-check. The CLI no longer carries its own review prompt, score request or critique pass; `--no-critique` is gone. Gates are not reported without a System One model. Cancelling a TUI review aborts the model calls.
- **Layout**: the backend lives in `core/` (`server.mjs`, `models.json`, `showcase.json`, `pb_migrations/`, `runtimes/`) and the CLI and TUI in `tui/` (was `bin/`). `pnpm start` runs `node core/server.mjs`; the Docker image and `start.sh` follow. Data folders (`pb_data`, `scores`, `.local`, `.pb`, `.env`) stay at the root, so existing installs keep working.
- **License**: CodeOtter is open source under the GNU AGPL-3.0 (was Elastic License 2.0). Self-hosting, modification and redistribution are free; a modified version offered as a network service must publish its source.
- **Auto-review** (Admin → Model provider → Review): every new or updated pull request in an onboarded repository is reviewed and the scores and review are posted, one PR at a time, on the same two-minute poll as triage. Drafts and PRs labelled `codeotter:skip` are left alone; a head commit is reviewed once.
- Every GitHub CLI call is now asynchronous. A `gh` round trip used to block every other request and poll loop in the process.
- `GET /healthz` answers without touching storage; the Docker and Render health checks use it instead of `/api/me`.
- CI workflow (`.github/workflows/ci.yml`): syntax check, strict web build and the offline test scripts on every push and pull request. SECURITY.md, FUNDING.yml and issue templates.
- The review and onboarding pages load on demand; the login and home pages no longer download the syntax highlighter.
- The CLI reads its version from package.json instead of a hard-coded string. Docs say Node 22, which the CLI already required.
- `pnpm build:tui-icon` output refreshed; `scripts/test-terminal-icon.mjs` passes again.

- Added a lightweight Blessed TUI to the existing CLI; interactive launches open connected repositories, while review, JSON, CI and MCP remain scriptable.
- Reused the web backend and configured engines directly, without requiring a running web server. An organization/repository tree shows all connections, saved reviews and sequential calculation of missing reviews without publishing comments.
- Added live PR previews, web-matched score colors, summary columns, formatted review details, folder walkthroughs, plain-text copying and clickable PR links. Review/Changes tabs use optional Delta for unified diffs with gutter-preserving wrapping.
- Added a favicon terminal header, brand orange accents, focus-only yellow highlights, structured skeletons and forward/reverse keyboard navigation. Compact layouts preserve score visibility.
- Added local workspace review and draft tools, cancellation, history and JSON export. Human-readable terminal views omit model identities; incomplete model answers and failed self-checks fail explicitly.
- Fixed local PocketBase lifetime and read recovery when another terminal closes; writes are never replayed. Included terminal runtime dependencies in Docker and isolated regression coverage.

## 0.6.0 (2026-10-08)

- **Cloudflare Clef** as a hosted System One provider (`cloudflare/clef`, `cloudflare/clef-flash`) through OpenRouter, on the same typed endpoint as Jev. OpenRouter System One model lists now come from its decision models.

- Forgejo/Gitea integration tests (`scripts/test-forges.mjs`) run again (broken since 0.5.0: missing `package.json` in the fixture, and the fixture model returned no blast radius) and now cover the self-check, accepted fixes, Describe (comment and PR description) and PR comment commands against a real server.

- **Accepted fixes**: on a re-review after new commits, each earlier suggestion whose code is now in the file but was not at the previously reviewed commit (compared line by line, ignoring indentation) is recorded for the repository. The 10 most recent go into language model and hosted System One reviews as fixes this team accepted; the list (up to 30) is editable under Settings → Repositories → ⚙️ → Accepted fixes. The positive counterpart of dismiss-and-remember learnings.

- **PR comment commands**: a pull request comment whose first line is `/review`, `/describe`, `/improve`, `/ask <question>`, `/docs` or `/changelog` runs that action and replies on the PR (`/review` re-reviews and posts scores and review; tools post their result). Only owners, members and collaborators (GitHub `author_association`; Forgejo/Gitea write permission) can trigger one. Polled every minute per onboarded repository; the command gets an 👀 reaction, and failures are replied to. Off by default: Admin → Model provider → Review → PR comment commands.

- **Docs** (Tools card): doc comments (JSDoc, docstrings, Go/Rust doc comments…) for functions and classes the PR adds or changes without one, matching the file's style, as committable inline suggestions.
- **Changelog** (Tools card): a changelog entry in the format, tense and detail of the repository's `CHANGELOG.md`, `CHANGES.md` or `HISTORY.md` at the PR head, shown as a block to paste or post as a comment. CodeOtter does not commit to the PR branch.
- Fixed: the Tools card's apply button (Update PR description, Post inline suggestions) never appeared.

- **Improve** (Tools card): code suggestions only, no scores. Each replaces a line range of the new file and carries a label (possible issue, security, performance, error handling, maintainability, enhancement); the self-check scores and filters them; Post inline suggestions publishes them as committable suggestions.
- Inline suggestions can span several lines: GitHub gets a multi-line suggestion (`start_line`); Forgejo and Gitea, whose review comments cover one line, show the replacement as a code block instead of a committable suggestion.

- **Ask** (Tools card): answers a free-form question about the PR from its diff and guidelines. Answers posted to the PR have HTML comments removed (so they cannot forge CodeOtter's comment markers) and @mentions defused.

- **Tools card** on the review page, driven by `PR_TOOLS` in `server.mjs` (`GET`/`POST /api/tools`): pick a tool, run it, post the result as an upserted PR comment, or apply it. Tools use the language model with the same dynamic context, diff budget and repository guidelines as reviews.
- **Describe**: title, type (Bug fix, Feature, Refactor…), summary bullets and a per-file change table. Update PR description writes a `<!-- codeotter:describe -->` block into the PR body, keeping the author's text and replacing the block on later runs.

- **Self-check**: language model findings go through a second pass of the same model, which scores each one 0-10 against the diff (wrong or unsupported, plausible, certain defect; a wrong suggested fix lowers it). Findings below the minimum are dropped, the rest ordered by score, and the score shows on each finding. Setting: Admin → Model provider → Review → Self-check (Off, 3, 5 default, 7). A pass that fails or skips a finding fails the review. CodeReviewer keeps its System One check.

- **Large pull requests**: a diff over the budget (Review → Diff sent to the model, or a model's context) is no longer cut at a character count. Files are ranked (main language, other code, docs and config, lockfiles and generated output) and added whole, largest first; a file too big to fit shows its leading hunks up to half the budget; deleted files and hunks that only remove lines are listed instead of shown; every file left out is named with its line counts. Applies to language model reviews and hosted System One models; local System One models keep their change digest.

- **Dynamic context**: review diffs extend each code hunk upward to its enclosing declaration (function, method, class; JS/TS, Python, Go, Rust, Java/C#, Kotlin, Swift, Ruby, PHP), read from the head revision, and cut trailing context to one line. Hunks never repeat lines shown by the previous hunk, and a file whose content does not match the diff is left as git produced it. Setting: Admin → Model provider → Review → Context above a change (Off, 8, 16 default, 32 lines). Fast triage is unchanged.

## 0.5.0 (2026-10-04)

- **Website**: [codeotter.io](https://codeotter.io) with docs at [codeotter.io/docs](https://codeotter.io/docs/); linked from the README and set as the repository homepage.
- **Kev 4B** (4,498 MB, Apache-2.0) added to the local System One catalog on Admin → Local models: the most accurate Kev, about five times slower than Kev 0.8B on CPU.
- llama.cpp runtime b11388 (was b11215); Linux arm64 now tries the Vulkan build before the CPU build. Existing installs keep their downloaded runtime until `runtime/llama` in the data directory is removed.
- **One-click deploy**: `install.sh` sets up CodeOtter on any Linux server (Docker, generated PocketBase password, Watchtower, and Caddy HTTPS when `CODEOTTER_DOMAIN` is set). Deploy to Azure (`deploy/azure.json`) and Render (`render.yaml`) buttons in the README; Linode StackScript in `deploy/linode-stackscript.sh`. `APP_URL` defaults to Render's and Railway's public address.
- **Automatic Docker updates**: each `v*` tag publishes `ghcr.io/dharmeshgurnani/codeotter` (`:latest`, `:X.Y.Z`, `:X.Y`; amd64 and arm64) from `.github/workflows/release-image.yml`. `docker-compose.yml` now pulls that image and runs Watchtower, which updates the CodeOtter container hourly. Admins see "vX.Y.Z available" in the sidebar when a newer release exists; `CODEOTTER_UPDATE_CHECK=0` disables the check.
- **Fast triage**: System One rates correctness risk and blast radius of every new or updated pull request in onboarded repositories (polled every 2 minutes) and sets the `codeotter/triage` commit status (`pending`, `success`, `failure` at or above the configured risk, `error` with the reason), plus an updatable PR comment when Post scores is on. About 80 seconds with Kev on CPU. Settings under Admin / Model provider / Fast triage; `POST /api/triage?pr=` runs one on demand. GitHub Actions wait job in `docs/ci-triage.md`. New GitHub App installs request `statuses: write`.
- Small-context local System One models read a digest of the whole change (every file with line counts, tests, areas, then the largest hunks) instead of the first characters of the raw diff.
- **Scores come from a model or not at all**: removed the rule-based System One stand-in (`runtimes/laya/serve.py`) and the in-server fallback that turned file counts and folder names into scores and gates. A System One model that fails to start, errors or skips a question now fails the review with the model's error on the review page, and nothing is posted to the PR. A language model that owns the scores must return all of them, including blast radius, or the review fails.
- **System One checks CodeReviewer's comments**: each CodeReviewer comment is sent to System One with its hunk, and only comments it judges, with at least 0.7 confidence, to name a concrete problem become findings (capped at the review's `maxFindings`). The summary states how many were kept.
- Small-context System One models (Laya 1,024 tokens, Kev 2,048) show an info icon on their cards in onboarding, Model provider and Local models: on larger pull requests they see only part of the change. Onboarding now preselects Kev 0.8B.
- Laya runtime 0.9.7. The 0.9.5 Linux build stopped with "Illegal instruction" on CPUs without AVX-512 (Docker on most laptops).
- Anthropic model list: `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-4-5`. Reviews ask for high effort and fail clearly if the reply is cut off.

## 0.4.0 (2026-10-01)

- **First-Time Setup & Onboarding Wizard**: automated first-launch detection routing fresh Docker / server deployments into a streamlined 4-step setup wizard (`/onboarding`): primary Git/OAuth provider selection (GitHub, Forgejo, Gitea) with non-blocking multi-forge connection advice, dual-engine AI model configuration (required System 1 + optional LLM with non-blocking asynchronous local model background downloads or hosted BYOK), multi-organization repository multi-selection, and direct landing onto the active organization's dashboard.
- **Native CodeOtter CLI & CI Review Engine**: zero-dependency standalone binary (`bin/codeotter.mjs` / `npx codeotter`) supporting instant local diff review (`codeotter review --staged`), PR scoring (`codeotter pr <num>`), CI merge gate enforcement with exit codes (`codeotter ci --fail-on-gate --min-score 60`), stdio Model Context Protocol (`codeotter mcp`) server, multi-agent anti-hallucination critique pass, and rich ANSI terminal scorecard rendering.
- Consolidate provider connections and sign-in under Admin / OAuth, with one sidebar link and separate connection tests.

- **Gitea repositories and OAuth**: GitHub, Forgejo and Gitea coexist with separate server credentials, namespaced repositories and OAuth identities. Reuses the shared review adapter, adds Gitea PKCE sign-in, and tests real Gitea/Forgejo servers together with isolated PocketBase and JSON storage.

- Forgejo repository reviews and OAuth sign-in alongside GitHub: separate organization/repository identities, REST discovery and diffs, root guidelines, linked issues, commit history, comment updates and inline suggestions. Adds isolated Forgejo/PocketBase integration tests and OAuth-only accounts that do not require a provider-verified email.

## 0.3.0 (2026-09-30)

- **"Smart Context" Outside-Diff Call Graph Impact Slicing & Blast Radius Fan-Out**: extracts modified function, method, and class symbols across diff hunks, scans repository files outside the diff for callers/importers using zero-dependency fast git/repo search, slices outside-diff call sites with exact file:line snippets into the review prompt (`Outside-Diff Call Graph Context`), instructs reviewers to verify cross-file contract compatibility and unhandled exception safety ("bugs live outside the diff"), upgrades `blastRadius()` to incorporate outside-caller fan-out into the score, and renders outside caller nodes directly in the review terminal Mermaid graph and GitHub PR comments.
- **Inline Line-Level `suggestion` Fixes & GitHub PR Review Thread Sync**: enriches each review finding with target `line` and exact `suggestion` replacement code (with deterministic `deriveSuggestionFromDetail(f, diff)` hunk/line fallback), renders interactive **Suggested Fix (`suggestion`)** cards with green `+` replacement highlighting and 1-click **"Copy fix"**, adds **"Post inline suggestion to GitHub"** (`POST /api/review-suggestions`) to publish committable GitHub `suggestion` blocks anchored to `path` and `line` (`repos/:owner/:repo/pulls/:number/reviews`), and adds a per-repository `postInlineSuggestions` setting in Settings → Repositories.
- **Incremental Commit-by-Commit Delta Reviews & In-Place GitHub PR Comment Upsert**: tracks reviewed `headSha` (`headRefOid`), compares `prevSha...headSha` commits and diffs on re-review, verifies and reports resolved prior findings (`✅ Resolved since prevSha`), displays commit/incremental delta badges and a "Re-run delta review" action on the PR review page, and updates existing GitHub PR comments in place (`<!-- codeotter:scores -->` and `<!-- codeotter:review -->`) via `PATCH /repos/:owner/:repo/issues/comments/:id` instead of posting duplicate comments.
- **Repo "Learnings"**: 1-click "Dismiss & remember rule" on review findings saves a persistent per-repository rule (`repoSettings[repo].learnings`), injects team learnings into LLM and System 1 review prompts, displays active learnings badges on PR reviews, and lets admins inspect/remove learned rules in Settings → Repositories.
- **Linked Issue & Requirement Validation (`Closes #123`)**: scans pull request titles, bodies, and branch names for referenced issues, validates acceptance criteria against the diff, and enforces the `issue_requirements` pre-merge gate.
- **Architecture & Blast Radius Mermaid Diagram**: renders interactive, 100% offline SVG flowchart diagrams in the review terminal and GitHub PR comments showing PR topology, cohort directories, modified files, test verification, hotspots, and outside callers.
- **Mobile-Responsive UI**: drawer auto-close on navigate, stacked tables on narrow viewports, layout overflow containment, and mobile viewport optimizations.

## 0.2.0 (2026-09-29)

- Single-command dev and production startup: `pnpm dev` launches backend, Vite with HMR, and auto-manages local PocketBase on `:8090` in one command; `pnpm start` auto-builds frontend if missing and starts the server. Automatic `.env` loading and zero-config local PocketBase lifecycle management.
- Hugging Face organization and author avatars shown next to providers and models across Model provider picklists and Local models rows.
- Side-by-side 30/70 review dashboard with markdown terminal view, per-card re-run actions, and dynamic OpenGraph / SEO metadata.
- Added a development-only, 74-second Flute cinematic film with camera rails, layered UI reveals, animated scores and simulated local model downloads. Includes repository settings, GitHub, findings and merge gates, fictional records with Dharmesh Gurnani throughout, an isolated read-only demo server, and silent 1080p/60 fps export.
- GitHub PR comments after review (`gh pr comment`, introduced 2026-09-28): two checkboxes in Settings ("Post scores on PR" and "Add PR review as a comment") automatically post all System One rubric scores / merge gates and/or the review summary with a link to the full details on the CodeOtter application page.
- Rebranded project to **CodeOtter** (`codeotter`) with a `DESIGN.md` token specification. The mascot is the otter with the score card (`assets/banners/hero-score-card.png`); the candidate mascot sheets, the `brand-showcase.html` exploration and the unused banner variants were removed from the repository. `assets/` now holds only what the README uses.
- System One models: a second engine next to the language model. TypeSafe Jev scores pull requests from fixed rubrics and answers merge gates (security, complexity, tests, docs, scope, repository guidelines), shown under Pre-merge checks. Runs in parallel with the language model; either engine works alone. Reachable directly from TypeSafe or through OpenRouter.
- Removed the "Review pull request" header button; open pull requests are reviewed from their repository page.
- The UI no longer names the storage backend.
- Local models moved to the Admin section (platform-wide; each organization still picks its own provider) and laid out like Model provider: a Language models section and a System One models section, both used together.
- Microsoft CodeReviewer as a third offline language option: a CodeT5 model that writes one review comment per diff hunk through a Python sidecar; needs a System One model for scores. Requests are no longer cut at Node's default 5-minute limit, so cold local sidecars can finish long reviews.
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
