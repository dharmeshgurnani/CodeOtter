# Contributing

Read `AGENTS.md` first; it holds the product and engineering rules this project is built on (JSON-driven pages, Animate UI first, organization scoping, no custom widgets).

- Backend: `core/server.mjs`, dependency-free Node 22+. CLI and TUI: `tui/`. UI: `web/` (Vite, React, Tailwind). Build the UI with `cd web && pnpm build`; the build is a strict type check. `pnpm test` runs the offline tests; `pnpm test:forgejo` and `pnpm test:gitea` need Docker.
- Run locally: `pnpm dev` (single command: backend on 4747, Vite on 5173 with HMR, and auto-managed local PocketBase on 8090) or `pnpm start` (production server).
- Schema changes go in `core/pb_migrations/`. Documentation changes travel with the code change (README for behaviour, ROADMAP for status, CHANGELOG entry).
- Open a pull request; the project reviews its own pull requests with itself.
