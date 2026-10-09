# CodeOtter: no-bullshit review (2026-10-08, v0.6.0)

Verified today: `cd web && pnpm build` passes (strict TS), `node --check server.mjs` passes, all 7 offline test
scripts pass (diff-compression, dynamic-context, accepted, self-reflection, smart-context, cli, pr-commands).
GitHub: 3 stars, 0 forks, 0 issues, 6 releases, repo is 11 days old.

## Verdict

Engineering: strong for its age. Product: real differentiator (typed System One scores + offline). Distribution:
zero. You have shipped six releases to an audience of three people. The next month should be 20% code, 80%
getting it in front of people, and the code work should be the things that make a stranger trust it in 60 seconds
(CI badge, eval numbers, bot identity, webhooks).

## What is genuinely good

- Dependency-free 4.6k-line backend that actually works across GitHub, Forgejo and Gitea, with local GGUF
  sidecars, PocketBase auth, Docker multi-arch, one-click installers. That is a lot of surface for 11 days.
- The dual-engine idea is a real wedge. Nobody else gives typed, rubric-bound scores from a decision model.
  Every competitor (CodeRabbit, PR-Agent/Qodo, Greptile, Ellipsis) asks an LLM for a number.
- "Scores come from a model or not at all" is the right call and is enforced (`score()` refuses CodeReviewer
  without S1). Honest beats impressive.
- Tests exist and run offline by slicing `// <block>` regions out of server.mjs. Clever and fragile, but it
  means the review pipeline has regression coverage. Most solo projects at this stage have none.
- AGENTS.md encodes real decisions. A contributor (human or agent) can be productive in one read.

## What is wrong, ranked by how much it costs you

1. **No CI on pull requests.** `.github/workflows/` only publishes the release image. A stranger sees no green
   badge, and you cannot tell if a PR breaks the build until you pull it. 30 minutes. Plan 01.
2. **Nobody can find it, and the license blocks the lists that would surface it.** ELv2 is not OSI-approved:
   awesome-selfhosted, many "awesome" lists and most package directories reject it on sight. You opened 27
   awesome-list PRs today; expect most to bounce on this. Decide: AGPL-3.0 (OSI, still blocks SaaS clones) or
   keep ELv2 and stop calling it open source anywhere. Plan 02.
3. **It posts as you, not as a bot.** Every PR comment comes from the operator's `gh` token identity. Teams
   will not install a reviewer that impersonates a human account. The GitHub App code already exists
   (`createGitHubAppJwt`, `getGitHubAppRepos`) but is only used to list repos. Plan 03.
4. **Polling, not webhooks.** Commands poll every minute per repo; triage lists open PRs every 2 minutes per
   repo. With 30 repos that is 1,800 API calls an hour at idle and a 60 to 120 second lag on `/review`.
   Already on the roadmap. Plan 04.
5. **15 synchronous `gh` calls on the request path.** `execFileSync` blocks the event loop; while one user's
   `gh pr list` runs, every other request and every poll loop waits. `ghAsync` already exists and is used 16
   times. Plan 05.
6. **No proof the scores are calibrated.** The README says "calibrated 0 to 100 scores". Nothing in the repo
   measures that. A 50-PR eval set with known outcomes and a published number is both the credibility asset
   and the marketing asset. Plan 06.
7. **Secrets sit in plaintext in PocketBase**, and the PocketBase admin UI is published on 8090 by compose
   (loopback only, but still). API keys, forge tokens, OAuth client secrets. Plan 07.
8. **No SECURITY.md, FUNDING.yml, issue templates, code of conduct.** The Sponsor button literally does not
   exist. 20 minutes. Plan 08.
9. **GitLab is missing.** Self-hosted GitLab is the default forge for exactly the "do not send code to a SaaS"
   buyer you are selling to. The forge adapter pattern is there. Plan 09.
10. **Full review is not automatic.** Triage runs on new PRs but the real review only runs from the UI or a
    `/review` comment. CodeRabbit's whole pitch is "it just shows up". One checkbox. Plan 10.
11. **The 871 KB single JS chunk.** Shiki and markdown load on the login page. Lazy import, one line. Plan 11.
12. **server.mjs at 4,600 lines in one file** with tests that carve it up by comment markers. Not urgent, but
    the test harness will break the first time someone moves a block. Plan 12.
13. Small stuff: CLI hard-codes `VERSION = "0.6.0"` separately from package.json; `store.all()` loads 500
    reviews on every home render; no cap on concurrent reviews; three untracked mascot PNGs in `web/public`.
    Plan 13.

## On getting sponsors and a YC-shaped story

- Sponsors follow users. Nobody sponsors a 3-star repo. Order: license decision, CI badge, eval number in the
  README, GitHub App listing, then Show HN and r/selfhosted on the same day, then FUNDING.yml.
- The YC-shaped version of this is not "cheaper CodeRabbit". It is "the only PR reviewer that runs air-gapped
  with typed, auditable scores". Defence, fintech, healthcare, EU public sector. The eval number and a SOC2-ish
  story (secrets at rest, audit log) are what that buyer asks for first.
- Dogfooding is your cheapest proof. CONTRIBUTING says the project reviews its own PRs. Make that visible:
  every PR on the public repo should carry a CodeOtter comment from the bot. Right now PR #18 has none a visitor
  would recognise.
- Stop adding PR-Agent-inspired tools for a month. Six tools shipped in one day (2026-10-04) that three people
  have seen. Breadth is not the constraint.

## Plans

One file per item in this directory, ordered by priority. Each has a Done-when line you can check.
