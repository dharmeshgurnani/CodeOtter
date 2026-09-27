# PR Scorer

Scores pull requests the way CodeRabbit summarises them: quality, blast radius, risk, tests, readability, PR hygiene, plus concrete findings and a file walkthrough. Backend is one dependency-free Node file; the UI is a small React app.

```
cd web && pnpm install && pnpm build && cd ..   # once, builds the React UI into web/dist
node server.mjs                                  # http://localhost:4747
```

UI is Vite + React + Tailwind with the Animate UI sidebar (collapsible, Ctrl+B, icon mode with tooltips). For UI work run `pnpm dev` inside `web/` alongside the server; Vite proxies `/api` to it. Without `web/dist` the server falls back to its own server-rendered pages.

Needs `gh` logged in. Model defaults to MiniMax (key read from `~/.pi/agent/auth.json`). Any OpenAI-compatible endpoint works:

```
LLM_BASE_URL=http://localhost:11434/v1 LLM_MODEL=qwen2.5-coder:latest node server.mjs   # Ollama, fully local
LLM_API_KEY=... LLM_MODEL=MiniMax-M3 node server.mjs                                     # explicit key
REPO=owner/name node server.mjs                                                          # default is the git repo you launch from
```

`/score?pr=<url|number>` renders the report, add `&json` for raw JSON, `&force=1` to rescore. Results cache in `scores/`.

Blast radius is deterministic (files, lines, areas, hotspots such as migrations, auth, payments, API routes, core domain, deps, CI). Everything else comes from the model.

Why not Jev: TypeSafe Jev is closed-weight and API-only, and it returns numbers without explanations. Point `LLM_BASE_URL` at any open model instead.
