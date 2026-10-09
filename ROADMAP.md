# Roadmap

| Status | Feature | Date |
| :---: | :--- | :--- |
| [x] | Auto-review: new and updated pull requests reviewed and posted without a command; CI on every PR; async gh; /healthz | 2026-10-09 |
| [x] | Repository TUI in the existing CLI, sharing web storage and engines without a web server; organization tree and automatic missing reviews | 2026-10-09 |
| [x] | Live score/summary previews, formatted details, folder walkthroughs, copying, PR links and Review/Changes tabs using Delta | 2026-10-09 |
| [x] | Branded favicon header, focus-aware selection, structured skeletons, compact layouts and keyboard navigation | 2026-10-09 |
| [x] | Independent local PocketBase lifetime, read recovery and CLI/TUI regression tests | 2026-10-09 |
| [x] | Lightweight workspace TUI: diff sources, reviews, Ask and draft tools, cancellation, history and JSON export | 2026-10-08 |
| [x] | Cloudflare Clef (`cloudflare/clef`, `cloudflare/clef-flash`) as a hosted System One provider via OpenRouter | 2026-10-08 |
| [x] | Accepted fixes: suggestions authors applied are remembered per repository and guide later reviews (PR-Agent-inspired) | 2026-10-04 |
| [x] | PR comment commands: /review, /describe, /improve, /ask, /docs, /changelog (PR-Agent-inspired) | 2026-10-04 |
| [ ] | PR events and comment commands via webhooks (GitHub App, Forgejo/Gitea) instead of polling; post as a GitHub App bot | |
| [x] | Docs and Changelog tools (PR-Agent-inspired) | 2026-10-04 |
| [x] | Improve: ranked, self-checked code suggestions posted as multi-line committable suggestions (PR-Agent-inspired) | 2026-10-04 |
| [x] | Ask: free-form questions about a PR (PR-Agent-inspired) | 2026-10-04 |
| [x] | Tools card + Describe (title, type, summary, file changes; apply to PR description) (PR-Agent-inspired) | 2026-10-04 |
| [x] | Self-check: second model pass scores findings 0-10 and drops weak ones (PR-Agent-inspired) | 2026-10-04 |
| [x] | Large-PR diff compression: ranked files, partial hunks, deletions and left-out files named (PR-Agent-inspired) | 2026-10-04 |
| [x] | Dynamic context: hunks extend to the enclosing declaration, trailing context cut to one line (first PR-Agent-inspired step) | 2026-10-04 |
| [x] | Website and docs at codeotter.io | 2026-10-04 |
| [x] | Kev 4B local System One model in the catalog; llama.cpp b11388 | 2026-10-04 |
| [x] | One-click deploy: `install.sh` for any VPS (Caddy HTTPS with a domain), Deploy to Azure and Render buttons, Linode StackScript | 2026-10-02 |
| [ ] | Linode: publish `bin/deploy/linode-stackscript.sh` as a public StackScript (cloud.linode.com/stackscripts/create) and add its button | |
| [ ] | Railway: template from `ghcr.io/dharmeshgurnani/codeotter` with a volume at `/app/pb_data` and a generated `PB_ADMIN_PASSWORD`; add the `railway.com/deploy/...` button | |
| [ ] | AWS: CloudFormation template (EC2 + `install.sh` user data) hosted in S3 for a Launch Stack button | |
| [ ] | DigitalOcean and Vultr: apply as marketplace vendors for 1-Click apps | |
| [ ] | Coolify and Dokploy: submit one-click templates | |
| [x] | Automatic Docker updates: release tags publish a multi-arch image to GHCR, Compose runs Watchtower, sidebar shows a newer release to admins | 2026-10-02 |
| [x] | Fast triage: System One rates correctness risk and blast radius of each new or updated PR from a whole-change digest, sets the `codeotter/triage` commit status and an updatable PR comment, polled every 2 minutes; GitHub Actions wait job in docs/ci-triage.md | 2026-10-02 |
| [ ] | Validate System One triage on past pull requests with known outcomes and set the default stop threshold from the results | |
| [x] | Full-Stack Setup & Onboarding Wizard (first-time deployment detection, primary Git/OAuth provider selection for GitHub/Forgejo/Gitea, dual-engine AI model configuration with non-blocking local background downloads, multi-org searchable repository onboarding, and direct dashboard landing) | 2026-10-01 |
| [x] | Native CodeOtter CLI & CI Review Engine (`bin/codeotter.mjs`, `codeotter review`, `codeotter pr`, `codeotter ci --fail-on-gate`, `codeotter mcp` stdio server, multi-agent critique pass, rich ANSI terminal scorecard) | 2026-10-01 |
| [x] | Forgejo repositories + OAuth alongside GitHub: implemented; isolated integration tests, production build and browser checks pass. User authorized the Gitea follow-up | 2026-09-30 |
| [x] | Gitea repositories + OAuth alongside GitHub and Forgejo: isolated integration tests, production build and browser checks pass | 2026-09-30 |
| [x] | "Smart Context" Outside-Diff Call Graph Impact Slicing & Blast Radius Fan-Out (AST symbol extraction, zero-dependency git/repo caller trace, contract safety verification, outside callers in Blast Radius and Mermaid graph, and prompt caching optimization) | 2026-09-30 |
| [x] | Inline Line-Level `suggestion` Fixes & One-Click Apply / GitHub Review Sync (`line` & `suggestion` finding schema, deterministic `deriveSuggestionFromDetail`, interactive `Suggested Fix` cards with 1-click Copy fix, `POST /api/review-suggestions` inline PR review thread sync, and per-repo `postInlineSuggestions` setting) | 2026-09-29 |
| [x] | Incremental Commit-by-Commit Delta Reviews (`headSha` tracking, `prevSha → headSha` commit compare diff, resolved findings tracking, and in-place GitHub PR comment upsert via `<!-- codeotter:scores -->` / `<!-- codeotter:review -->`) | 2026-09-29 |
| [x] | Repo "Learnings" (1-click dismiss finding to persistent per-repository team rule, injected into LLM & System 1 prompts and editable in Settings → Repositories) | 2026-09-29 |
| [x] | Linked Issue & Requirement Validation (`Closes #123` acceptance criteria in LLM prompt, System 1 `issue_requirements` merge gate, and PR badges) | 2026-09-29 |
| [x] | Architecture & Blast Radius Mermaid Diagram (`flowchart LR` SVG graph in review terminal and GitHub PR comments) | 2026-09-29 |
| [x] | Hugging Face model & provider icons in selection lists and local model rows | 2026-09-29 |
| [x] | Cinematic CodeOtter product film with camera rails, layered UI, fictional data and reproducible Flute rendering | 2026-09-28 |
| [x] | Post scores on PR (`gh pr comment` with System One scores and merge gates) | 2026-09-28 |
| [x] | Add PR review as a comment (`gh pr comment` with review summary and link to full platform report) | 2026-09-28 |
