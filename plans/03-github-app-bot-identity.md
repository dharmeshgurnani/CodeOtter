# 03. Post as a GitHub App bot, not as the operator

Priority: P0 · Effort: M (1 to 2 days) · Type: feature

## Problem
Every GitHub write goes through `gh` with the operator's token (`server.mjs:666` `gh()`, `:674` `ghAsync()`;
comment posting around `:2600` to `:2680`, review threads `:2510`). Comments appear from a human account.
Teams will not install a reviewer that impersonates a person. The App machinery already exists
(`createGitHubAppJwt` `:1881`, `getGitHubAppRepos` `:1898`, manifest flow at `/github/manifest/callback`) but
is only used to list repositories.

## Lazy fix
- `appToken(repo)`: installation token from the existing JWT code, cached per installation until `expires_at`
  minus 60 s. Stdlib only.
- `ghFetch(path, init, repo)`: `fetch("https://api.github.com/" + path)` with that token, `redirect: "error"`.
- Replace every GitHub write (issue comments, review threads, PR body, commit status) with `ghFetch`.
  Reads can stay on `gh` for now. About ten call sites.
- No App configured: keep the current `gh` path. One `if`.

## Done when
A review comment shows `codeotter[bot]`. Confirm the manifest requests `pull_requests: write`,
`statuses: write`, `contents: read`, `issues: write`.

## Skip
GitHub Marketplace listing. After 100 stars; it needs a verified org and a privacy page.
