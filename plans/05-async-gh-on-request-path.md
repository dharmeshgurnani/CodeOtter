# 05. Stop blocking the event loop with synchronous gh calls

Priority: P1 · Effort: S (1 hour) · Type: fix

## Problem
15 `gh(...)` calls use `execFileSync` (`server.mjs:666`). Request-path sites: 961, 965, 982, 986, 1136, 2112,
2315, 2646, 2663, 2677, 3329, 3551, 4105. Each blocks every other request, both poll loops and the sidecar
heartbeat for the length of a network call. `ghAsync` exists at `:674` and is already used 16 times.

## Lazy fix
Mechanical: `gh(` becomes `await ghAsync(` at each site; mark the enclosing function `async`; await its callers.
`guideFiles` (`:942`) and `openPrs` (`:3326`) are the ones with sync callers to chase.
Then delete the sync `gh` so it cannot return. The two startup calls (`:55`, `:1970`) run before `listen` and
can stay sync.

## Done when
`grep -c "\bgh(" server.mjs` is 0 apart from the definition, and `node scripts/test-pr-commands.mjs` passes.
