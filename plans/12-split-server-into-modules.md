# 12. Split server.mjs along the lines the tests already cut

Priority: P3 · Effort: M (1 day) · Type: update

## Problem
4,600 lines in one file. The tests slice regions out by `// <name>` and `// </name>` comment markers and run
them through `new Function` (`scripts/test-diff-compression.mjs`, `test-pr-tools.mjs`, others). Moving a block
or adding a cross-block reference silently breaks a test, or makes it test stale code.
"Dependency-free" is a rule in AGENTS.md; "single file" is not.

## Lazy fix
Move exactly the marked blocks into `lib/<name>.mjs` with named exports, import them in server.mjs, and have
the tests import the module instead of slicing text. Nothing else moves. Markers today: `dynamic-context`,
`diff-compression`, `self-reflection`, `accepted`, `pr-tools`, `pr-commands`, `smart-context`.
Dockerfile gains `COPY lib ./lib`.

## Done when
No test reads `server.mjs` as a string, and `server.mjs` is under 3,000 lines.

## Skip
Splitting the HTTP router or `SETTINGS_PAGES`. Long but linear, and nothing tests them in isolation.
