# Plan: a downloadable, local System One model

Status: proposed, not started. Goal: one click in Settings → Model provider → System One model downloads a model that runs on the user's machine and answers the same typed questions Jev does, with no API key and no data leaving the box. The reference experience is Handy (voice to text): pick a model, click download, watch progress, use it.

## What can and cannot be shipped

- **Jev cannot be downloaded.** It is closed-weight and API-only. The local option is therefore a different, open-weight model behind the same typed interface, not Jev itself. Name it honestly in the UI: "Local model (open weights)", not "Jev local".
- **There is no open-weight System One model today.** What can be shipped is an open small language model driven in a way that produces typed answers with probabilities: for every question, read the model's next-token probabilities over a fixed set of allowed answers instead of letting it generate text. That gives `noul` (P(yes)), `score` (distribution over level indices) and `choice` (distribution over labels) with real probabilities from the logits, schema-safe by construction, in a single forward pass per question. Same contract as `POST /v1/systemone`, so the rest of the app does not change.

## Architecture

```
Settings (Local model: Download)  →  server.mjs download manager  →  ~/.pr-scorer/models/*.gguf
                                                                  →  llama-server sidecar (per-platform binary)
score()  →  askSystemOne(state, questions)  →  provider "local"  →  typed adapter  →  llama-server /completion (n_probs)
```

1. **Runtime**: llama.cpp's `llama-server`, spawned by `server.mjs` the way `gh` and PocketBase already are. Keeps the backend dependency-free (no native npm modules). Binaries come from llama.cpp GitHub releases per platform (Windows x64 CPU, macOS arm64 Metal, Linux x64 CPU, optional CUDA/Vulkan builds), downloaded on first use next to the models. The Docker image bakes the Linux CPU build in.
2. **Model files**: GGUF from Hugging Face (`huggingface.co/<repo>/resolve/main/<file>`), stored under `models/` in the data directory (`~/.pr-scorer/models`, or `/app/pb_data/models` in Docker so the volume persists them). Streamed download with byte progress, `Range` resume, size check against the HF metadata and a sha256 recorded in the catalog.
3. **Typed adapter** (`local` provider in `S1_PROVIDERS`): builds one prompt per question from the shared state, asks llama-server for the top-k next-token probabilities after a fixed answer prefix, and maps them:
   - `noul`: prompt ends with "Answer yes or no:"; P(yes) = p(" yes") / (p(" yes") + p(" no")).
   - `score`: levels are numbered 0..n-1 in the prompt; distribution over the digit tokens; `score` = expectation, `confidence` = top probability, same fields as TypeSafe's answer.
   - `choice`: labels lettered A.. in the prompt; distribution over letter tokens.
   Questions run concurrently against one loaded model (llama-server handles parallel slots; the shared state is cached as a common prefix so the diff is processed once).
4. **State size**: local models get a smaller context (8k to 32k tokens). The adapter caps the diff and adds the change facts and file list first, so the cheap-but-important context survives truncation.

## Model catalog (ship as data, not code)

`models.json` in the repo, each entry: id, display name, Hugging Face repo and file, size, sha256, license, min RAM, notes. Initial candidates, all Apache-2.0 GGUF, chosen for code understanding at small size:

| Model | File | Size | Notes |
|---|---|---|---|
| Qwen2.5-Coder 1.5B Instruct | `q4_k_m` | ~1.0 GB | default: fast on CPU, decent on diffs |
| Qwen2.5-Coder 1.5B Instruct | `q8_0` | ~1.8 GB | better calibration, still CPU-friendly |
| Qwen2.5-Coder 7B Instruct | `q4_k_m` | ~4.7 GB | "quality" option, needs 8 GB RAM or a GPU |

Adding a model later is one row in the catalog. The picklist on the settings page is fed from it, with size and license shown beside each entry.

## Settings page behaviour (JSON-driven, no new JSX beyond one control)

- System One provider picklist gains "Local model (open weights)".
- Model picklist shows the catalog; entries that are already downloaded are marked. Selecting one that is not downloaded shows a **Download** action.
- New generic control `progress` in `json-form.tsx` (a bar and a label) fed by polling `GET /api/settings/model/download-status`; the download is started by the existing page-action mechanism (`POST /api/settings/model/download`). Cancel and delete actions for the model.
- Test connection works the same as for Jev (one `noul`).

## Docker

- Linux CPU `llama-server` baked into the image; models are not baked in (size). First run downloads to the volume. An optional build arg pre-downloads the default model for air-gapped hosts.
- Healthcheck unchanged; the sidecar is started lazily on the first typed request and stopped after an idle period.

## Calibration and honesty

- Before default-on, run the same 30 to 50 pull requests through Jev and the local model and compare scores and gate decisions. Publish the agreement numbers in the README; pick the default quantisation from that.
- The report footer names the engine ("System One: local qwen2.5-coder-1.5b"). Gate probabilities from the local model are logit-derived, not calibrated by a provider, and the docs say so.

## Phases

1. **Runtime and adapter** (server only): spawn `llama-server`, typed adapter, `local` provider, works with a manually placed GGUF. Verify a `noul` on a toy diff and a full review on a real PR.
2. **Download manager**: catalog, streamed download with resume and checksum, status endpoint, delete. Settings page with the progress control.
3. **Platform binaries**: per-OS `llama-server` fetch with checksum; Docker bake; GPU builds as an opt-in setting.
4. **Calibration run and docs**: comparison against Jev, README section, CHANGELOG, AGENTS.md rule ("local System One answers are logit-derived probabilities").

Rough size: phase 1 is about the size of the Jev integration; phase 2 about the same again; phases 3 and 4 smaller.

## Risks

- **Speed on CPU**: an 80k-character diff is ~20k tokens; a 1.5B model on a laptop CPU processes that in seconds to tens of seconds, once per review thanks to prefix caching. Acceptable, but slower than Jev's sub-second answers. The 7B option needs a GPU to be pleasant.
- **Quality gap**: a 1.5B model will be a weaker judge than Jev on subtle questions (security, guideline violations). The calibration run decides whether it can be the default or stays a "no key, no cloud" option.
- **Disk and bandwidth**: 1 to 5 GB per model; the catalog shows sizes before download, downloads are resumable.
- **Licensing**: stick to Apache-2.0 or MIT weights in the catalog; avoid models with use restrictions.
