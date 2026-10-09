# 01. CI on every pull request

Priority: P0 · Effort: S (30 min) · Type: fix

## Problem
`.github/workflows/release-image.yml` is the only workflow. PRs merge with no build or test run. No badge in README.

## Lazy fix
One workflow, `.github/workflows/ci.yml`:
```yaml
name: CI
on: { push: { branches: [main] }, pull_request: {} }
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm, cache-dependency-path: web/pnpm-lock.yaml }
      - run: node --check server.mjs
      - run: pnpm -C web install --frozen-lockfile && pnpm -C web build
      - run: for t in scripts/test-*.mjs; do case $t in *forge*) continue;; esac; node $t || exit 1; done
```
The scripts are plain `assert` files, not `node:test`, so the loop is the runner. Add the badge under the
existing shields in README.

## Done when
A PR that breaks the build shows a red check. README shows a CI badge.

## Skip
Forge integration tests need Docker. Run them by hand or as a nightly job later.
