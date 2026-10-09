# 04. Webhooks for PR events and comment commands

Priority: P1 · Effort: M (1 day) · Type: feature (already on ROADMAP)

## Problem
`server.mjs:2969` polls comments every 60 s per repo. `:416` triage polls `openPrs()` every 120 s per repo.
N repos means N calls a minute at idle, 60 to 120 s latency on `/review`, and rate limits at scale.

## Lazy fix
- `POST /api/webhook/github` (and `/forgejo`, `/gitea`). Verify `X-Hub-Signature-256` with
  `crypto.createHmac` and `timingSafeEqual`. Secret generated once, shown on Admin → OAuth.
- Three events only: `pull_request` opened/synchronize → `triagePr` (plus full review when Plan 10 is on);
  `issue_comment` created → existing `parseCommand` + `runCommand`. Everything else 204.
- The webhook route is exempt from the cross-site check and from `gate()`; the signature is the auth.
- Keep both polling loops as fallback, but only when no webhook secret is set. One `if` each.
- The GitHub App (Plan 03) subscribes to the events itself; Forgejo and Gitea need the URL added in repo settings.

## Done when
A `/review` comment triggers within 5 s with polling off. A bad signature gets 401.

## Skip
Event replay, dedup table, queue. Add dedup by delivery ID only after a double post is seen.
