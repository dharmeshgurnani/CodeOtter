<div align="center">

<p align="center">
  <img src="assets/banners/hero-score-card.png" alt="CodeOtter AI Code Review Platform" width="520" style="max-width: 100%; height: auto; border-radius: 10px;" />
</p>

# 🦦 CodeOtter

### Autonomous, self-hosted AI code reviews, calibrated scoring gauges, and merge gates — running on your own hardware with any open model.

<p align="center">
  <a href="#-quickstart"><strong>Quickstart</strong></a> &middot;
  <a href="#what-is-codeotter"><strong>What is CodeOtter</strong></a> &middot;
  <a href="#-how-it-works-the-dual-engine"><strong>Dual Engine</strong></a> &middot;
  <a href="#-100-offline-mode-zero-cloud"><strong>Offline Mode</strong></a> &middot;
  <a href="#-docker-deployment"><strong>Docker</strong></a> &middot;
  <a href="#-security--privacy"><strong>Security & Privacy</strong></a> &middot;
  <a href="#-star-history"><strong>Star History</strong></a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-ELv2-c2410c.svg" alt="Elastic License 2.0" /></a>
  <a href="package.json"><img src="https://img.shields.io/badge/Node-%3E%3D20.11-111111.svg" alt="Node Version" /></a>
  <a href="#-security--privacy"><img src="https://img.shields.io/badge/Privacy-Zero_Telemetry-15803d.svg" alt="Zero Telemetry" /></a>
  <a href="#what-is-codeotter"><img src="https://img.shields.io/badge/Deployment-100%25_Self--Hosted-15803d.svg" alt="100% Self Hosted" /></a>
  <a href="#-100-offline-mode-zero-cloud"><img src="https://img.shields.io/badge/Models-Local_GGUF_%7C_BYOK-b45309.svg" alt="Local or BYOK" /></a>
  <a href="https://star-history.com/#dharmeshgurnani/CodeOtter&Date"><img src="https://img.shields.io/github/stars/dharmeshgurnani/CodeOtter?style=flat&color=eab308" alt="GitHub Stars" /></a>
</p>

</div>

---

## What is CodeOtter?

**CodeOtter** is an open-source, self-hosted pull request review platform built for engineering teams who want calibrated code intelligence without sending private code to third-party SaaS clouds or paying **$24–$30/developer/month**.

Run it **100% offline** on your workstation with open-weight Hugging Face models (`llama.cpp` + `ggmlc` sidecars), or connect your own keys for Claude, OpenAI, MiniMax, or OpenRouter.

<p align="center">
  <a href="assets/videos/codeotter-cinematic-film-silent.mp4"><picture><source srcset="assets/videos/hero-showcase.gif" type="image/gif"><img src="assets/videos/hero-showcase.jpg" alt="CodeOtter AI Code Review Dashboard" width="960" /></picture></a>
</p>

---

## Features

<table>
<tr>
<td width="50%" valign="middle">

### Side-by-Side 30/70 Review Dashboard

Inspect calibrated **0–100 score gauges** (`Quality`, `Blast Radius`, `Risk`, `Tests`, `Readability`, `PR Hygiene`) on the left while reading the streaming **Markdown review terminal**, interactive **Architecture & Blast Radius Mermaid diagram** (100% offline SVG flowchart renderer with raw Mermaid source toggle), cohort file walkthroughs, and severity-ranked findings on the right. Re-run scores or narrative independently with one click.

[Quickstart →](#-quickstart)

</td>
<td width="50%">
  <a href="assets/videos/codeotter-cinematic-film-silent.mp4"><picture><source srcset="assets/videos/tile-review-dashboard.gif" type="image/gif"><img src="assets/videos/tile-review-dashboard.jpg" alt="CodeOtter 30/70 Review Dashboard and Markdown Terminal" width="100%" /></picture></a>
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Deterministic System 1 Scores &amp; Merge Gates

Standard LLM prompts hallucinate numbers. CodeOtter pairs your language model with a **System 1 decision engine** (`POST /v1/systemone`) that evaluates **6 rubric scores** and **8 yes/no pre-merge gates** (`Title`, `Description`, `Security`, `Complexity`, `Tests`, `Docs`, `Scope`, `Guidelines`) in a single fast pass.

[Dual Engine Architecture →](#-how-it-works-the-dual-engine)

</td>
<td width="50%">
  <a href="assets/videos/codeotter-cinematic-film-silent.mp4"><picture><source srcset="assets/videos/tile-system-one.gif" type="image/gif"><img src="assets/videos/tile-system-one.jpg" alt="System 1 Rubric Scores and Pre-Merge Safety Gates" width="100%" /></picture></a>
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### 100% Offline Local Models

Download open-weight GGUF and CodeT5 checkpoints directly from Hugging Face inside **Admin → Local models**. CodeOtter automatically manages `llama-server` (`llama.cpp`), `laya` (`ggmlc`), and Python sidecars with discrete Vulkan/Metal GPU detection.

[Offline Mode →](#-100-offline-mode-zero-cloud)

</td>
<td width="50%">
  <a href="assets/videos/codeotter-cinematic-film-silent.mp4"><picture><source srcset="assets/videos/tile-local-models.gif" type="image/gif"><img src="assets/videos/tile-local-models.jpg" alt="One-click Local Models Manager in CodeOtter" width="100%" /></picture></a>
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### `AGENTS.md` / `CLAUDE.md`, Repo Learnings &amp; GitHub PR Sync

Automatically detects `AGENTS.md` and `CLAUDE.md` at the root of each onboarded repository to enforce team rules on every diff hunk. Dismiss any review finding with **1-click ("Dismiss & remember rule")** to persist a repository team learning that is automatically injected into future LLM and System 1 review prompts (and managed under **Settings → Repositories → ⚙️**). Enable **Post scores on PR** and **Add PR review as a comment** to publish formatted scorecards directly on GitHub pull requests via `gh pr comment`.

[Security &amp; Privacy →](#-security--privacy)

</td>
<td width="50%">
  <a href="assets/videos/codeotter-cinematic-film-silent.mp4"><picture><source srcset="assets/videos/tile-github-sync.gif" type="image/gif"><img src="assets/videos/tile-github-sync.jpg" alt="Repository Guidelines and Automated GitHub PR Comments" width="100%" /></picture></a>
</td>
</tr>
</table>

---

## Supported Models &amp; Providers

Works with **any local open-weight model or hosted API** — mix and match System 1 and System 2 engines freely.

<p>
  <a href="https://huggingface.co/Anthropic"><kbd><img src="https://cdn-avatars.huggingface.co/v1/production/uploads/1670531762351-6200d0a443eb0913fa2df7cc.png" alt="Anthropic" width="16" valign="middle" /> Claude Opus / Sonnet</kbd></a> &nbsp;
  <a href="https://huggingface.co/openai"><kbd><img src="https://cdn-avatars.huggingface.co/v1/production/uploads/68783facef79a05727260de3/UPX5RQxiPGA-ZbBmArIKq.png" alt="OpenAI" width="16" valign="middle" /> OpenAI GPT-5</kbd></a> &nbsp;
  <a href="https://huggingface.co/Qwen"><kbd><img src="https://cdn-avatars.huggingface.co/v1/production/uploads/6215ca5692c0ecfba9186921/hrRM50-6XcdWgg2AKpENG.jpeg" alt="Qwen" width="16" valign="middle" /> Qwen2.5-Coder (1.5B / 7B)</kbd></a> &nbsp;
  <a href="https://huggingface.co/MiniMaxAI"><kbd><img src="https://cdn-avatars.huggingface.co/v1/production/uploads/676e38ad04af5bec20bc9faf/dUd-LsZEX0H_d4qefO_g6.jpeg" alt="MiniMax" width="16" valign="middle" /> MiniMax-M3</kbd></a> &nbsp;
  <a href="https://huggingface.co/deepseek-ai"><kbd><img src="https://cdn-avatars.huggingface.co/v1/production/uploads/6538815d1bdb3c40db94fbfa/xMBly9PUMphrFVMxLX4kq.png" alt="DeepSeek" width="16" valign="middle" /> DeepSeek-Coder / V3</kbd></a> &nbsp;
  <a href="https://huggingface.co/meta-llama"><kbd><img src="https://cdn-avatars.huggingface.co/v1/production/uploads/646cf8084eefb026fb8fd8bc/oCTqufkdTkjyGodsx1vo1.png" alt="Meta Llama" width="16" valign="middle" /> Llama 3.1 / 3.3</kbd></a> &nbsp;
  <a href="https://huggingface.co/microsoft/codereviewer"><kbd><img src="https://cdn-avatars.huggingface.co/v1/production/uploads/1583646260758-5e64858c87403103f9f1055d.png" alt="Microsoft" width="16" valign="middle" /> Microsoft CodeReviewer</kbd></a> &nbsp;
  <a href="https://huggingface.co/mys/laya-typed-decisions-GGUF"><kbd><img src="https://cdn-avatars.huggingface.co/v1/production/uploads/1596903074565-noauth.jpeg" alt="Laya" width="16" valign="middle" /> Laya Typed-Decisions</kbd></a> &nbsp;
  <a href="https://huggingface.co/mys/kev-0.8b-GGUF"><kbd><img src="https://cdn-avatars.huggingface.co/v1/production/uploads/6215ca5692c0ecfba9186921/hrRM50-6XcdWgg2AKpENG.jpeg" alt="Kev" width="16" valign="middle" /> Kev 0.8B (S1)</kbd></a> &nbsp;
  <a href="https://console.typesafe.ai"><kbd><img src="https://cdn-avatars.huggingface.co/v1/production/uploads/1596903074565-noauth.jpeg" alt="TypeSafe Jev" width="16" valign="middle" /> TypeSafe Jev</kbd></a> &nbsp;
  <a href="https://ollama.com"><kbd><img src="https://cdn-avatars.huggingface.co/v1/production/uploads/noauth/MMgt1jNfE_ML3JWg3hz41.png" alt="Ollama" width="16" valign="middle" /> Ollama</kbd></a> &nbsp;
  <a href="https://openrouter.ai"><kbd><img src="https://huggingface.co/front/assets/huggingface_logo-noborder.svg" alt="OpenRouter" width="16" valign="middle" /> OpenRouter</kbd></a> &nbsp;
  <kbd>+ any OpenAI-compatible or local GGUF endpoint</kbd>
</p>

---

## CodeOtter is right for your team if

- ✅ You want **enterprise-grade PR reviews** without sending private code to a third-party cloud
- ✅ You want **calibrated 0–100 scores and deterministic gates**, not hallucinated guesses
- ✅ You want to **enforce team conventions** (`AGENTS.md` / `CLAUDE.md`) automatically on every PR
- ✅ You want to run **100% offline on local hardware** (MacBook, Linux workstation, air-gapped GPU)
- ✅ You want **zero per-seat billing** ($0 forever for self-hosting)
- ✅ You want an **instant, zero-dependency deployment** with Docker or lightweight Node

---

## ⚡ Quickstart

### Local Setup (Requires Node 20.11+ & pnpm)

Ensure the **GitHub CLI (`gh`)** is authenticated (`gh auth status`):

```bash
# 1. Clone the repository
git clone https://github.com/dharmeshgurnani/CodeOtter.git
cd CodeOtter

# 2. Build and launch
pnpm run build
pnpm start
```

Open **`http://localhost:4747`** in your browser:
1. Paste any GitHub PR URL or select from your active repositories in the sidebar.
2. Select your AI provider under **Settings → Model provider** (or download a 100% offline local model under **Admin → Local models**).
3. Get a calibrated review report in seconds—or query `/api/score?pr=<url|number>` for JSON.

---

## 🧠 How It Works: The Dual Engine

<p align="center">
  <img src="assets/banners/dual-engine.jpg" alt="CodeOtter Dual Engine Architecture" width="100%" />
</p>

Asking a single chat LLM to both generate nuanced code critiques *and* output calibrated numeric scores fails in practice: chat models cluster every score between `75` and `85` and significantly slow down generation.

CodeOtter separates review into **two specialized engines that run concurrently**:

```mermaid
flowchart LR
  PR["GitHub PR Diff + Metadata\n+ Auto-detected AGENTS.md / CLAUDE.md"] --> Facts["Deterministic Blast Radius\nFiles · Lines · Areas · Hotspots"]
  PR --> LLM["Engine 1: Language Model (System 2)\nWalkthrough · File Cohorts · Actionable Findings"]
  PR --> S1["Engine 2: System One Model (System 1)\n6 Calibrated Rubric Scores + 8 Pre-Merge Gates"]
  Facts --> Report["Unified PR Review Report\nScores · Gates · Effort · Findings"]
  LLM --> Report
  S1 --> Report
```

### 1. Language Model (System 2 — Prose & Cohorts)
Produces the human-readable review narrative:
- **Executive Walkthrough**: High-level context of what changed, commit progression, and linked issue requirement validation (`Closes #123`, `Fixes #456`).
- **File Cohorts**: Groups related file modifications into logical review units.
- **Actionable Findings**: Severity-ranked issues (`⚠️ High / Major`, `⚠️ Medium / Minor`, `🛠️ Low / Refactor`, `🧹 Nitpick`).

### 2. System One Model (System 1 — Typed Scores & Merge Gates)
Evaluates structured rubrics and merge-policy criteria in a single lightning-fast pass:
- **6 Calibrated Scores (`0–100`)**: `Quality`, `Blast Radius`, `Correctness Risk`, `Test Coverage`, `Readability`, and `PR Hygiene`.
- **9 Pre-Merge Policy Gates**: `Title check`, `Description check`, `Security` (injection, auth bypass, secrets, SSRF, XSS), `Complexity`, `Tests`, `Documentation`, `Scope`, `Repository guidelines` (`AGENTS.md` / `CLAUDE.md` compliance), and `Issue requirements` (validates diff against linked GitHub issue acceptance criteria).

*Both engines run in parallel; reviews take only as long as the slowest pass. Either engine can also operate standalone.*

---

## 💻 100% Offline Mode (Zero Cloud)

<p align="center">
  <img src="assets/banners/offline-vault.jpg" alt="CodeOtter Offline Vault" width="100%" />
</p>

Review proprietary code on an airplane or within an air-gapped data center with **zero network requests leaving your machine**.

With 1-click downloads directly from **Admin → Local models**, open-weight models download with optimized local runtimes:

| Model | Engine Role | Ideal For | Hugging Face |
| :--- | :--- | :--- | :--- |
| **Laya Typed-Decisions** | System 1 (Scores & Gates) | Instant rubric scoring & gate checks | [`mys/laya-typed-decisions-GGUF`](https://huggingface.co/mys/laya-typed-decisions-GGUF) |
| **Kev** | System 1 (Scores & Gates) | High-confidence decision calibration | [`mys/kev-0.8b-GGUF`](https://huggingface.co/mys/kev-0.8b-GGUF) |
| **Qwen2.5-Coder (Compact)** | System 2 (Prose & Walkthrough) | Fast local walkthroughs on laptops | [`Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF`](https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF) |
| **Qwen2.5-Coder (Standard)** | System 2 (Prose & Walkthrough) | In-depth code critiques & findings | [`Qwen/Qwen2.5-Coder-7B-Instruct-GGUF`](https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF) |
| **Microsoft CodeReviewer** | System 2 (Hunk Findings) | Specialized diff-hunk comment generation | [`microsoft/codereviewer`](https://huggingface.co/microsoft/codereviewer) |

- **Smart Resource Management**: Local model runtimes spin up on-demand on the first review and automatically shut down after **15 idle minutes** to conserve memory and battery.
- **Hardware Acceleration**: Automatic GPU detection with seamless CPU fallback ensures smooth execution on everything from developer laptops to dedicated servers.
- **Intelligent Context Optimization**: Diffs and questions are dynamically formatted to match model context windows for high-speed, reliable local inference.

---

## 🛡️ Auto-Detected `AGENTS.md` & `CLAUDE.md` Enforcement

<p align="center">
  <img src="assets/banners/merge-gate-agents.jpg" alt="CodeOtter Spot-Checking AI Agents at the Merge Gate" width="100%" />
</p>

Every repository onboarded in CodeOtter is automatically inspected at its root via the GitHub API for `AGENTS.md` and/or `CLAUDE.md`.
- **Zero Configuration**: When either (or both) files exist, team guidelines are automatically injected into the review context.
- **Enforced at the Merge Gate**: Violations of architecture conventions, file structures, or coding guidelines trigger warnings in the `Repository guidelines` merge gate.
- **Per-Repository Controls**: Toggle guideline enforcement per repository anytime with a single click.

---

## 🐳 Docker Deployment

A production-ready Docker container packages the complete CodeOtter platform—including persistent storage, team auth, and model runners. Deploy anywhere that runs a container (Docker Compose, Railway, Fly.io, Render, Coolify, or a bare VPS).

```bash
# 1. Prepare environment
cp .env.example .env       # Set GH_TOKEN and optional model keys

# 2. Launch with Compose
docker compose up -d       # Dashboard available on http://localhost:4747
```

Or run standalone:

```bash
docker build -t codeotter .
docker run -d -p 4747:4747 -p 8090:8090 --env-file .env -v codeotter-data:/app/pb_data codeotter
```

- `GH_TOKEN` authenticates `gh` inside the container without interactive prompts.
- Mount `/app/pb_data` as a volume to persist reviews, settings, and downloaded local models across upgrades.

---

## 🏢 Multi-Organization & Team Management

<table>
<tr><td width="30%"><b>Organization Scoping</b></td><td>Switch between teams and organizations seamlessly from the header dropdown. All dashboards, open PR queues, and settings remain isolated.</td></tr>
<tr><td><b>1-Click GitHub App Setup</b></td><td>Under <b>Admin → OAuth</b>, click <i>"Create GitHub app for me"</i> to configure OAuth credentials automatically in one step.</td></tr>
<tr><td><b>Role-Based Access (RBAC)</b></td><td>Owner, Admin, and Developer tiers safeguard sensitive model keys and organization settings. The first user to sign in automatically becomes the instance Owner.</td></tr>
<tr><td><b>Zero-Restart Configuration</b></td><td>All provider keys, local models, and repository settings update live through the dashboard without restarting services.</td></tr>
</table>

---

## 🔒 Security & Privacy

- **Zero Telemetry / No Middleman**: Code diffs and metadata never leave your network unless you explicitly configure a hosted AI provider. Zero analytics, zero phone-home calls.
- **Calibrated & Sanitized Outputs**: Model responses are validated, normalized, and sanitized before display, eliminating prompt injections and hallucinated scores.
- **Hardened Access**: Enterprise-grade session security, strict cross-origin protections, and masked credential management protect your infrastructure and repositories.

---

## ⭐ Star History

<p align="center">
  <a href="https://star-history.com/#dharmeshgurnani/CodeOtter&Date">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=dharmeshgurnani/CodeOtter&type=Date&theme=dark" />
      <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=dharmeshgurnani/CodeOtter&type=Date" />
      <img alt="CodeOtter Star History Chart" src="https://api.star-history.com/svg?repos=dharmeshgurnani/CodeOtter&type=Date" width="100%" />
    </picture>
  </a>
</p>

---

## 📄 License & Community

- **License**: Distributed under the [Elastic License 2.0 (ELv2)](LICENSE) — free to self-host and customize.
- **Contributing**: Contributions and feedback are welcome! Please check out [`CONTRIBUTING.md`](CONTRIBUTING.md) to get started.
