# 13. Small fixes (one sitting)

Priority: P2 · Effort: S (2 hours) · Type: fix

Each is a one-liner or close. Do them together.

1. **CLI version drift.** `bin/codeotter.mjs` has `const VERSION = "0.6.0"`. Read it from `../package.json`
   the way `server.mjs:35` does. Done when a release bumps both for free.
2. **Home loads every review.** `pbStore.all()` fetches `perPage=500` and `homeData` filters in memory. Pass
   the org as a PocketBase filter (`repo ~ "org/"`) with `perPage=50`. Done when home is one query per org.
   `// ponytail: 500 cap; paginate when a team has more reviews than that`.
3. **Concurrent reviews unbounded.** `activeReviews` has no limit; N users pressing Re-review fan out N model
   runs and N `gh` subprocesses. A counter and a 429 "review in progress" above 3. Plan 10's serial chain
   covers it if that lands first.
4. **Untracked mascot PNGs** in `web/public/` (three files). Commit or delete; `git status` should be clean.
5. **Pin pnpm in the Dockerfile** web stage (`npm i -g pnpm@10`) so a pnpm major does not break the image build
   on a release day.
6. **README says Node 20.11+**. Dockerfile uses 22 and `process.loadEnvFile` in the CLI needs 20.12. Say 22.
7. **Health check does a PocketBase auth-refresh per probe** (`/api/me`). Add `GET /healthz` returning 200 with
   no store call; point `HEALTHCHECK` and `render.yaml` at it.
