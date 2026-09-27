# Plan: downloadable and local System One models

Status: proposed, not started. Goal: one click in Settings → Model provider → System One model downloads a model that runs on the user's machine and answers the same typed questions Jev does, with no API key and no data leaving the box. Reference experience: Handy (voice to text) — pick a model, click download, watch progress, use it.

## What exists (verified 2026-09-27)

Jev itself is closed-weight and API-only and cannot be shipped. Open alternatives now exist that speak the same typed interface, and several expose TypeSafe's exact `POST /v1/systemone` contract, which the app already talks to:

| Model | Maker | Params | Weights | Runtime | Serve | Fit for one-click |
|---|---|---|---|---|---|---|
| **Laya** (English) | Convai Innovations | 421M (ModernBERT-large encoder + decision head) | Apache-2.0, GGUF via ggmlc: F16 807 MB, Q8_0 431 MB, Q4 401 MB | `laya` binary from ggmlc releases (MIT); CPU, CUDA, Metal | `laya serve model.gguf --port 8080`; `POST /api/decide` and TypeSafe-compatible `POST /v1/systemone` | **Yes**: single binary + one file |
| Laya multilingual | Convai Innovations | 322M, 100+ languages | same | same | same | Yes |
| Laya typed-decisions | Convai Innovations | 421M, 1024-token context, tuned for choice/score/noul workflows | same sizes | same | same | Yes, candidate default |
| **Kev** 0.8B / 4B / 9B / 27B | Jared Palmer | Qwen3.5-based LoRA + pointer head | Apache-2.0 on Hugging Face | Python 3.12 + uv, PyTorch/CUDA/ROCm/MLX; no binaries; ggmlc can also run Kev 0.5B/0.8B F16 on CPU (102 / 465 ms per preset) | `uv run --extra serve python -m kev.serve --run jaredpalmer/kev-4b --port 8009`; `/v1/systemone` identical | 0.8B via ggmlc: maybe; 4B+: external endpoint (GPU) |
| **SemIf** (OpenJev) | Theo Lee | reads option logits from stock 4B models | MIT code, upstream model licences | Python, GPU-class (3090) | `/v1/systemone` server available (`semif-server`) | External endpoint |
| mpuig/system-one | M. Puig | Qwen3-0.6B / MiniCPM5-2B fine-tunes | MIT | Apple MLX only | `POST /v1/systemone` on 8399 | External endpoint (Mac) |

Accuracy references from their own logs: Kev-27B 0.848 vs Jev 0.857 on new sources; smaller Kev trails on knowledge-heavy questions; mpuig's 0.6B tier 22/24 vs Jev 23/24 on its example set. Laya claims ~33 ms per query on GPU, 25 ms on a laptop RTX 4050, and runs on CPU.

## Two tiers

**Tier 1, bundled one-click (Laya).** The only family with a prebuilt single-binary runtime and sub-GB weights. This is the Handy experience: the app downloads the `laya` binary for the platform and a GGUF, starts it as a sidecar, and talks `/v1/systemone` to it. No Python, no GPU required.

**Tier 2, external endpoint (everything else).** A "Custom System One endpoint" provider: base URL plus optional bearer key. Covers Kev, SemIf, mpuig, a Laya server someone runs on a GPU box, or any future `/v1/systemone` server. This is one entry in `S1_PROVIDERS` and can ship immediately, ahead of tier 1.

## Architecture (tier 1)

```
Settings: System One → "Laya (local, downloads ~430 MB)" → Download
  server.mjs download manager → data dir/models/laya_typed_decisions_q8_0.gguf (+ laya binary for the OS)
  server.mjs sidecar → laya serve <gguf> --port <free port>   (started lazily, stopped after idle)
score() → askSystemOne(state, questions) → provider "laya" → http://127.0.0.1:<port>/v1/systemone
```

- **No adapter code**: the sidecar speaks the same request and response shape the app already uses for Jev; only the base URL differs. If `/v1/systemone` lags behind `/api/decide` in ggmlc, a thin mapping lives in `askSystemOne`, nothing else changes.
- **Runtime binary**: fetched from the ggmlc GitHub `latest` release per platform (macOS Metal; Linux and Windows CPU, CUDA optional), checksum recorded in the catalog, stored beside the models. The backend stays dependency-free: it spawns a process, as it does for `gh` and the storage backend.
- **Model files**: Hugging Face `resolve/main/<file>` URLs, streamed with byte progress, `Range` resume, size and sha256 check. Data dir: `~/.pr-scorer/models` locally, `/app/pb_data/models` in Docker so the volume keeps them.
- **Context**: Laya's typed-decisions variant has a 1024-token context. The state must be compact: change facts, file list, title, description, and a trimmed diff (or per-file summaries). This is the main engineering question of tier 1 and must be measured on real PRs; the base English Laya may have a longer window and be the better fit for diffs.
- **Concurrency**: one sidecar, questions batched in one request as now.

## Catalog (data, not code)

`models.json` in the repo: id, label, maker, HF repo and file, size, sha256, license, context, notes, runtime (`laya`). Initial rows: Laya typed-decisions Q8_0 (default candidate), Laya English Q8_0, Laya multilingual Q8_0, plus the F16 variants for accuracy. Kev 0.8B via ggmlc is added once its GGUF and `/v1/systemone` path are verified.

## Settings page (JSON-driven)

- System One provider picklist gains "Laya (local)" and "Custom System One endpoint".
- For Laya: model picklist from the catalog with size and "downloaded" markers; **Download**, **Delete**, and **Test connection** actions; a new generic `progress` control in `json-form.tsx` fed by a status endpoint polled while a download runs. Hardware line: CPU or GPU detected, and the measured probe latency.
- For the custom endpoint: base URL, key, Test connection. Nothing else.

## Docker

Bake the Linux `laya` binary into the image; models download to the volume on first use; optional build arg pre-bakes the default model for air-gapped hosts. Sidecar starts lazily.

## Calibration and honesty

Run the same 30 to 50 pull requests through Jev and each local candidate; compare scores and gate decisions; publish agreement numbers in the README; choose the default variant from that. The report footer already names the engine; local answers are labelled as such.

## Phases

0. **Custom System One endpoint provider** (small, ship now): unlocks Kev, SemIf, mpuig and self-hosted Laya for anyone who runs one.
1. **Laya sidecar with a hand-placed binary and GGUF**: spawn, health, `/v1/systemone` probe, a full review on a real PR; settle the context strategy.
2. **Download manager and settings UI**: catalog, resumable download with checksum, progress control, delete.
3. **Per-platform binaries, Docker bake, GPU opt-in.**
4. **Calibration run and docs.**

Phase 1 is smaller than the Jev integration was (no adapter); phase 2 is the largest piece.

## Risks

- **Context**: 1024 tokens is tight for diffs; may force per-file scoring or the base model. Measure before committing to a default.
- **Quality gap**: a 421M encoder will trail Jev on subtle security or guideline questions; the calibration run decides default-on versus opt-in.
- **Runtime churn**: ggmlc and Laya are days to weeks old; pin release tags and checksums, and keep the custom-endpoint tier as the escape hatch.
- **Licensing**: Laya weights Apache-2.0, ggmlc MIT, Kev Apache-2.0 (check the Qwen base licence per size). Only these in the catalog.

## Sources

- Laya: https://huggingface.co/convaiinnovations/laya , https://laya.convaiinnovations.com/ , GGUF builds https://huggingface.co/mys/laya-GGUF and https://huggingface.co/mys/laya-typed-decisions-GGUF
- ggmlc runtime: https://github.com/monatis/ggmlc
- Kev: https://github.com/jaredpalmer/kev , https://huggingface.co/jaredpalmer/kev-4b
- SemIf: https://github.com/TheoLeeCJ/SemIf-OpenJev , https://github.com/andrea-tomassi/semif-server
- mpuig/system-one: https://github.com/mpuig/system-one
- Node/ONNX runner for Laya (alternative, native dependency): https://github.com/receptron/laya
