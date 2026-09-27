# PR Scorer

Scores pull requests the way hosted review bots such as CodeRabbit summarise them: quality, blast radius, risk, tests, readability, PR hygiene, plus concrete findings and a file walkthrough. Self-hosted, any open model. Backend is one dependency-free Node file; the UI is a small React app.

Requires Node 20.11+, pnpm, and the GitHub CLI (`gh`) logged in.

```
cd web && pnpm install && pnpm build && cd ..   # once, builds the React UI into web/dist
node server.mjs                                  # http://localhost:4747
```

UI is Vite + React + Tailwind with the Animate UI sidebar (collapsible, Ctrl+B, icon mode with tooltips). For UI work run `pnpm dev` inside `web/` alongside the server; Vite proxies `/api` to it. Without `web/dist` the server falls back to its own server-rendered pages.

Pick the model under **Settings → Model provider** inside the app: Anthropic (Claude), OpenAI (ChatGPT), MiniMax, OpenRouter, Ollama, or any custom OpenAI-compatible endpoint. Settings persist in PocketBase (or `config.json` without it) and apply to the next review, no restart. The env vars below are only the defaults when nothing is saved:

```
LLM_BASE_URL=http://localhost:11434/v1 LLM_MODEL=qwen2.5-coder:latest node server.mjs   # Ollama, fully local
LLM_API_KEY=... LLM_MODEL=MiniMax-M3 node server.mjs                                     # explicit key for the default provider (MiniMax)
ANTHROPIC_API_KEY=... node server.mjs                                                     # per-provider keys (also OPENAI_API_KEY, MINIMAX_API_KEY, OPENROUTER_API_KEY) are used once that provider is selected in Settings
REPO=owner/name node server.mjs                                                          # optional: seeds the first repository; add more under Settings → Repositories
PORT=8080 APP_URL=https://pr.example.com node server.mjs                                 # port, and the public address used for the GitHub sign-in callback
```

`/api/score?pr=<url|number>` returns the review as JSON, `/score?pr=` renders it server-side, `&force=1` rescores. Both need a signed-in admin or owner once an account exists.

## Settings pages

Settings is a group of sidebar links, one per page, no landing page. Every page is a JSON schema served by the backend (`SETTINGS_PAGES` in `server.mjs`) and rendered by one generic form component; adding a setting is one object in the schema, never new JSX. Controls stay plain: picklists, text, range inputs.

- **Repositories**: the onboarded repositories of the active organization (the one picked in the sidebar header; every page is scoped to it). The gear on a row opens the repository's settings: "Auto-detected" shows the `AGENTS.md` / `CLAUDE.md` found at the repository root, checked through the GitHub API, with a checkbox that decides whether reviews follow them (on by default). Both files are used when both exist; violations come back as findings. Each one is a sidebar link showing its reviewed and open pull requests; "Add repository" in the sidebar opens this page. Without any saved, the app uses `REPO` or the repository it was launched from.
- **Model provider**: two engines on one page. The **language model** (Anthropic, OpenAI, MiniMax, OpenRouter, Ollama, custom) writes the walkthrough and findings. The **System One model** (TypeSafe Jev first; more later) answers typed questions in one fast pass: every score from fixed rubrics (the five review scores and blast radius) and yes/no gates (title, description, security, complexity, tests, docs, scope, repository guidelines) shown under Pre-merge checks; the language model is then not asked for scores at all. With only a language model, it scores too, as before. With only a System One model you get scores and gates, no prose. With both, they run in parallel and each owns its part, so the review takes as long as the slower engine, not the sum. Two ways to reach Jev: TypeSafe directly (`TYPESAFE_API_KEY`), or "TypeSafe Jev via OpenRouter" with an OpenRouter key, which serves the same typed endpoint; OpenRouter also lists `typesafe/jev-router` as a language model that routes each request to a suitable model. Plus review knobs (max findings, diff size, temperature).
- **OAuth**: sign-in with GitHub through PocketBase's built-in OAuth2 on the `users` collection. Create a GitHub OAuth app, paste the client id and secret, and use the callback URL shown on the page (`<APP_URL>/auth/callback`). Needs PocketBase. Set `APP_URL` when the app runs behind a domain. GitLab, Forgejo and Bitbucket are planned.

## Accounts

Every signed-in account has a role. **owner** can do everything; **admin** can do everything except Admin → Accounts (role management). Platform-wide pages live in the sidebar's **Admin** section (OAuth, Accounts), shown to admins and owners in every organization; organization-scoped pages stay under Settings. A **developer** role is reserved and not built yet. The first account to sign in becomes the owner, later ones admins; the owner changes roles under Admin → Accounts. Until any account exists, an anonymous visitor can use every page so the instance can be set up; once an owner exists, everything except the login page needs a signed-in admin or owner. Locked out (sign-in broken, no session)? Restart with `PR_SCORER_RECOVERY=1`, fix Admin → OAuth, then unset it.

## Security notes

Reviews send the pull request diff and description to the model provider you configure, nowhere else. Model output is treated as untrusted and normalised before storage. All API routes refuse cross-site requests, session cookies are HttpOnly, and settings that hold keys never return them. Sign-in, accounts, and every data endpoint are gated by role once an owner exists.

## Sign-in

`/login` is a split page: the left column is the only way in, a single "Continue with GitHub" button; the right column is showcase space (sponsors, customers, case studies) drawn over an animated dithered shader in the app's palette. Its content lives in `showcase.json` next to the server, so it changes without a code change. The sidebar footer holds the account: "Log in with GitHub" when signed out, the user's avatar, name and email with a Log out item when signed in. The header shows the organization (owners of the onboarded repositories). Login uses PocketBase's manual OAuth2 flow through the app server: `/api/auth/start` returns the GitHub authorization URL, GitHub returns to `/auth/callback`, and the PocketBase user token is kept in an HttpOnly cookie. Once an owner exists, signing in is required for everything except the login page.

## Storage

Reviews are stored in [PocketBase](https://pocketbase.io) when `PB_URL` is set (the Docker image sets it), otherwise as JSON files in `scores/`. PocketBase needs a superuser login via `PB_ADMIN_EMAIL` and `PB_ADMIN_PASSWORD`; the schema lives in `pb_migrations/` and is applied on start. Any files left in `scores/` are imported into PocketBase the first time the server starts against it.

## Docker

One image runs PocketBase and the app together. It works anywhere that runs a container (Docker, Compose, Railway, Fly, a VPS).

```
cp .env.example .env      # fill in GH_TOKEN, REPO, LLM_API_KEY, PB_ADMIN_*
docker compose up --build # app on :4747, PocketBase admin UI on :8090/_/
```

Or without Compose:

```
docker build -t pr-scorer .
docker run -p 4747:4747 -p 8090:8090 --env-file .env -v pr-scorer-data:/app/pb_data pr-scorer
```

`GH_TOKEN` replaces `gh auth login` inside the container; `REPO` is optional (repositories are onboarded in Settings). Set `APP_URL` to the public address so the GitHub sign-in callback works. Persist `/app/pb_data` or the reviews go with the container. The PocketBase admin UI is bound to loopback by default.

Blast radius is deterministic (files, lines, areas, hotspots such as migrations, auth, payments, API routes, core domain, deps, CI). Everything else comes from the model.

Why not Jev: TypeSafe Jev is closed-weight and API-only, and it returns numbers without explanations. Point `LLM_BASE_URL` at any open model instead.
