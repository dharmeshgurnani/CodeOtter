# Fast triage in CI

CodeOtter's System One model rates every new or updated pull request (correctness risk and blast radius) within minutes and
sets the `codeotter/triage` commit status:

| Status | Meaning |
| --- | --- |
| `pending` | Triage running |
| `success` | Risk below the threshold: let the pipeline run |
| `failure` | Risk at or above the threshold: stop and look at the change |
| `error` | System One failed (model not loaded, runtime error). The reason is in the status description |

Turn it on under **Admin / Model provider / Fast triage** (Automatic, Fail status at risk). CodeOtter polls onboarded
repositories every two minutes, so it needs no inbound webhook and works on a local install. With **Post scores on PR**
enabled for the repository, the same result is also posted as a PR comment that updates on each push.

## GitHub Actions: stop the long pipeline early

Put the triage wait first and make the expensive jobs depend on it. A `failure` or `error` stops everything after it.

```yaml
on: pull_request

jobs:
  codeotter-triage:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    permissions:
      statuses: read
    steps:
      - name: Wait for codeotter/triage
        env:
          GH_TOKEN: ${{ github.token }}
          REPO: ${{ github.repository }}
          SHA: ${{ github.event.pull_request.head.sha }}
        run: |
          for i in $(seq 1 90); do
            line=$(gh api "repos/$REPO/commits/$SHA/statuses" \
              --jq '([.[] | select(.context == "codeotter/triage")][0] // empty) | "\(.state)\t\(.description)"')
            state=${line%%$'\t'*}
            echo "codeotter/triage: ${line:-not posted yet}"
            case "$state" in
              success) exit 0 ;;
              failure|error) echo "::error::CodeOtter triage: ${line#*$'\t'}"; exit 1 ;;
            esac
            sleep 10
          done
          echo "::error::codeotter/triage was not posted within 15 minutes"; exit 1

  validation:
    needs: codeotter-triage
    runs-on: ubuntu-latest
    steps:
      - run: echo "the hour-long build, tests and validation go here"
```

The newest status for a context comes first in the API response, so a re-triage after a push replaces the old result.

You can also require `codeotter/triage` in branch protection so a red triage blocks the merge button.

## Accuracy

Triage reads a digest of the whole change sized to the model's context (every changed file with its line counts, tests and
areas, then the largest hunks). Small-context models (Laya: 1,024 tokens, Kev 0.8B: 2,048) see only part of a large
pull request, so treat the score as a signal for where to look, not a verdict on the code.
