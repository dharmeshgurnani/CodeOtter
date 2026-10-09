# 08. SECURITY.md, FUNDING.yml, issue templates, code of conduct

Priority: P1 · Effort: S (20 min) · Type: update

## Problem
There is no Sponsor button because `.github/FUNDING.yml` does not exist. No `SECURITY.md`, so a security
product has no disclosure path. No issue templates, so the first bug reports will be one-liners.

## Lazy fix
- `.github/FUNDING.yml`: `github: [dharmeshgurnani]`. Enable GitHub Sponsors first; approval takes about a day.
- `SECURITY.md`: supported versions (latest minor), a security@ address, 72 h acknowledgement.
- `.github/ISSUE_TEMPLATE/bug.yml` with three fields: version, provider and model, what happened.
  `feature.yml` with one field. `config.yml` linking the docs.
- `CODE_OF_CONDUCT.md`: Contributor Covenant 2.1 verbatim.

## Done when
The repo header shows Sponsor and the Security tab shows a policy.
