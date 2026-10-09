# 02. License decision: AGPL-3.0 or stop saying open source anywhere

Priority: P0 · Effort: S (decision) + S (file change) · Type: update

## Problem
LICENSE is ELv2. Not OSI-approved. awesome-selfhosted, most awesome-* lists and "open source alternative to X"
roundups reject it on the LICENSE file alone. The 27 list PRs opened 2026-10-08 will mostly bounce on this.
README copy already says "free to self-host" (good), but directories read the LICENSE file, not the copy.

## Options
1. **AGPL-3.0 (recommended).** OSI-approved, accepted by every list, and a SaaS competitor cannot host it
   without publishing their changes. Leaves a commercial dual-license path for enterprises that refuse AGPL.
2. Keep ELv2. Accept the rejections. Audit the website for any remaining "open source" wording.

## Lazy fix (option 1)
Replace LICENSE, set `"license": "AGPL-3.0-only"` in both package.json files, update the README badge, one
CHANGELOG line. Sole author, so no CLA problem.

## Done when
`gh api repos/dharmeshgurnani/CodeOtter --jq .license.spdx_id` prints `AGPL-3.0` and the blocked list PRs
are re-requested.

## Skip
CLA bot and contributor license tooling until a second regular contributor exists.
