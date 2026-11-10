<div align="center">

<img src="assets/banners/hero-score-card.png" alt="CodeOtter AI Code Review" width="520" />

# 🦦 CodeOtter

### Self-hosted AI code review that scores every pull request.

**6 calibrated 0–100 scores · 9 yes/no merge gates · 100% offline or bring your own keys · $0 per seat**

<p>
  <a href="#-deploy-in-one-click"><strong>Deploy</strong></a> &middot;
  <a href="https://codeotter.io"><strong>Website</strong></a> &middot;
  <a href="https://docs.codeotter.io/docs"><strong>Docs</strong></a> &middot;
  <a href="#-features"><strong>Features</strong></a> &middot;
  <a href="#-why-codeotter"><strong>Why CodeOtter</strong></a> &middot;
  <a href="#-sponsors"><strong>Sponsors</strong></a>
</p>

<p>
  <a href="https://github.com/dharmeshgurnani/CodeOtter/stargazers"><img src="https://img.shields.io/github/stars/dharmeshgurnani/CodeOtter?style=social" alt="GitHub Stars" /></a>
  <a href="https://github.com/dharmeshgurnani/CodeOtter/actions/workflows/ci.yml"><img src="https://github.com/dharmeshgurnani/CodeOtter/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL--3.0-c2410c.svg" alt="AGPL-3.0" /></a>
  <a href="https://docs.codeotter.io/docs/security"><img src="https://img.shields.io/badge/Privacy-Zero_Telemetry-15803d.svg" alt="Zero Telemetry" /></a>
  <a href="https://docs.codeotter.io/docs/local-gguf-sidecar"><img src="https://img.shields.io/badge/Models-Local_GGUF_%7C_BYOK-b45309.svg" alt="Local or BYOK" /></a>
  <a href="package.json"><img src="https://img.shields.io/badge/Node-%3E%3D22-111111.svg" alt="Node Version" /></a>
</p>

<p>
  <a href="assets/videos/codeotter-cinematic-film-silent.mp4"><picture><source srcset="assets/videos/hero-showcase.gif" type="image/gif"><img src="assets/videos/hero-showcase.jpg" alt="CodeOtter review dashboard" width="960" /></picture></a>
</p>

**⭐ Star the repo to follow releases.** New git providers, local models and review features ship every few weeks.

</div>

---

## 🚀 Deploy in one click

<p>
  <a href="https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fraw.githubusercontent.com%2Fdharmeshgurnani%2FCodeOtter%2Fmain%2Fbin%2Fdeploy%2Fazure.json"><img src="https://aka.ms/deploytoazurebutton" alt="Deploy to Azure" height="32" /></a>
  &nbsp;
  <a href="https://render.com/deploy?repo=https://github.com/dharmeshgurnani/CodeOtter"><img src="https://render.com/images/deploy-to-render-button.svg" alt="Deploy to Render" height="32" /></a>
  &nbsp;
  <a href="https://railway.com/deploy/cl00sB"><img src="https://railway.com/button.svg" alt="Deploy on Railway" height="32" /></a>
</p>

Any Linux server (Docker):

```bash
curl -fsSL https://raw.githubusercontent.com/dharmeshgurnani/CodeOtter/main/bin/install.sh | bash
```

Local (Node 22+ and pnpm; for GitHub repositories, `gh auth status`):

```bash
git clone https://github.com/dharmeshgurnani/CodeOtter.git
cd CodeOtter
pnpm dev      # http://localhost:5173 (or pnpm start for production on :4747)
```

Full guides: **[Quickstart](https://docs.codeotter.io/docs/quickstart)** · **[Docker quickstart](https://docs.codeotter.io/docs/docker-quickstart)**.

---

## 🦦 Why CodeOtter

| | Typical hosted AI reviewer | **CodeOtter** |
| :--- | :--- | :--- |
| Price | $24–$30 per developer per month | **$0, free to self-host** |
| Where your code goes | Vendor cloud | **Your server; never leaves it with local models** |
| Air-gapped / offline | No | **Yes: llama.cpp, ggmlc and CodeT5 sidecars** |
| Models | Vendor's choice | **Claude, OpenAI, MiniMax, OpenRouter or any local GGUF** |
| Scores | Prose opinions | **6 calibrated 0–100 scores + 9 merge gates from a System 1 model** |
| Git providers | Usually GitHub first | **GitHub, Bitbucket Cloud & Data Center, Azure DevOps, Forgejo, Gitea** |
| Team conventions | Config files per vendor | **Your existing `AGENTS.md` / `CLAUDE.md`** |
| Source | Closed | **Open source, AGPL-3.0** |

---

## ✨ Features

<table>
<tr>
<td width="50%" valign="middle">

### Review Dashboard

Six 0–100 score gauges beside the streaming review, a blast-radius diagram and severity-ranked findings. Re-run scores or the review on its own with one click.

[Review dashboard →](https://docs.codeotter.io/docs/review-features)

</td>
<td width="50%">
  <a href="assets/videos/codeotter-cinematic-film-silent.mp4"><picture><source srcset="assets/videos/tile-review-dashboard.gif" type="image/gif"><img src="assets/videos/tile-review-dashboard.jpg" alt="CodeOtter 30/70 Review Dashboard and Markdown Terminal" width="100%" /></picture></a>
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Scores &amp; Merge Gates

A System 1 model answers 6 scored rubrics and 9 yes/no merge gates in one pass. Typed answers, not numbers guessed by a chat model.

[Dual engine →](https://docs.codeotter.io/docs/dual-engine)

</td>
<td width="50%">
  <a href="assets/videos/codeotter-cinematic-film-silent.mp4"><picture><source srcset="assets/videos/tile-system-one.gif" type="image/gif"><img src="assets/videos/tile-system-one.jpg" alt="System 1 Rubric Scores and Pre-Merge Safety Gates" width="100%" /></picture></a>
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### 100% Offline Models

Download open-weight GGUF and CodeT5 models from Hugging Face in one click. CodeOtter runs the sidecars and picks up your GPU.

[Offline mode →](https://docs.codeotter.io/docs/local-gguf-sidecar)

</td>
<td width="50%">
  <a href="assets/videos/codeotter-cinematic-film-silent.mp4"><picture><source srcset="assets/videos/tile-local-models.gif" type="image/gif"><img src="assets/videos/tile-local-models.jpg" alt="One-click Local Models Manager in CodeOtter" width="100%" /></picture></a>
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Every Git Provider

Reviews follow your `AGENTS.md` / `CLAUDE.md` and post committable fixes inline. Works with GitHub, Bitbucket, Azure DevOps, Forgejo and Gitea.

[Review features →](https://docs.codeotter.io/docs/review-features)

</td>
<td width="50%">
  <a href="assets/videos/codeotter-cinematic-film-silent.mp4"><picture><source srcset="assets/videos/tile-github-sync.gif" type="image/gif"><img src="assets/videos/tile-github-sync.jpg" alt="Repository Guidelines and Automated GitHub PR Comments" width="100%" /></picture></a>
</td>
</tr>
</table>

**Also included:**
[PR commands](https://docs.codeotter.io/docs/review-features) (`/review` `/describe` `/improve` `/ask` `/docs` `/changelog`) ·
[incremental reviews and team learnings](https://docs.codeotter.io/docs/review-features) ·
[webhooks from your own GitHub App](https://docs.codeotter.io/docs/review-features) ·
[CLI, terminal UI and MCP server](https://docs.codeotter.io/docs/cli) ·
[fast triage in CI](https://docs.codeotter.io/docs/ci-triage) ·
[accounts, roles and invites](https://docs.codeotter.io/docs/accounts-and-roles) ·
[zero telemetry](https://docs.codeotter.io/docs/security)

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
  <a href="https://openrouter.ai/cloudflare/clef"><kbd><img src="https://www.cloudflare.com/favicon.ico" alt="Cloudflare Clef" width="16" valign="middle" /> Cloudflare Clef</kbd></a> &nbsp;
  <a href="https://ollama.com"><kbd><img src="https://cdn-avatars.huggingface.co/v1/production/uploads/noauth/MMgt1jNfE_ML3JWg3hz41.png" alt="Ollama" width="16" valign="middle" /> Ollama</kbd></a> &nbsp;
  <a href="https://openrouter.ai"><kbd><img src="https://huggingface.co/front/assets/huggingface_logo-noborder.svg" alt="OpenRouter" width="16" valign="middle" /> OpenRouter</kbd></a> &nbsp;
  <kbd>+ any OpenAI-compatible or local GGUF endpoint</kbd>
</p>

---

## 📚 Documentation

All documentation lives at **[docs.codeotter.io](https://docs.codeotter.io/docs)** ([source](https://github.com/dharmeshgurnani/codeotter-docs)).

| Topic | Guide |
| :--- | :--- |
| Run locally | [Quickstart](https://docs.codeotter.io/docs/quickstart) |
| Deploy | [Docker quickstart](https://docs.codeotter.io/docs/docker-quickstart) · [Accounts and roles](https://docs.codeotter.io/docs/accounts-and-roles) |
| Models | [BYOK provider config](https://docs.codeotter.io/docs/byok-config) · [Local GGUF & sidecars (100% offline)](https://docs.codeotter.io/docs/local-gguf-sidecar) |
| Git providers | [Bitbucket](https://docs.codeotter.io/docs/bitbucket) · [Azure DevOps](https://docs.codeotter.io/docs/azure-devops) · [Forgejo](https://docs.codeotter.io/docs/forgejo) · [Gitea](https://docs.codeotter.io/docs/gitea) |
| Reviews | [Dual engine](https://docs.codeotter.io/docs/dual-engine) · [Review features](https://docs.codeotter.io/docs/review-features) · [`AGENTS.md` / `CLAUDE.md`](https://docs.codeotter.io/docs/repository-guidelines) · [Fast triage in CI](https://docs.codeotter.io/docs/ci-triage) |
| Terminal | [CLI, TUI & MCP server](https://docs.codeotter.io/docs/cli) |
| Reference | [Security & privacy](https://docs.codeotter.io/docs/security) · [Development & integration tests](https://docs.codeotter.io/docs/development) |

---

## ⭐ Star History

If CodeOtter saves you a review cycle or a per-seat bill, **[give it a star](https://github.com/dharmeshgurnani/CodeOtter)**. It is the main way other teams find it.

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

## 💛 Sponsors

CodeOtter is free to self-host with no paid tier. Sponsorship pays for maintainer time and for the model credits that review every CodeOtter pull request with CodeOtter.

<p align="center">
  <a href="https://github.com/sponsors/dharmeshgurnani"><img src="https://img.shields.io/badge/Sponsor-GitHub_Sponsors-db2777.svg?logo=githubsponsors&logoColor=white" alt="Sponsor on GitHub" /></a>
</p>

| | What you get |
| :--- | :--- |
| **Individual** | Name in the release notes |
| **Company** | Logo and link here and on [codeotter.io](https://codeotter.io) |
| **AI and infrastructure partners** | Model or compute credits; listed as a supported provider or deploy target |

Company and partner sponsorship: **sponsors@codeotter.io**.

<!-- sponsors -->
<p align="center"><em>Your logo here.</em></p>
<!-- /sponsors -->

---

## 📄 License & Community

- **License**: Open source under the [GNU AGPL-3.0](LICENSE). Free to self-host, modify and redistribute; anyone who runs a modified version as a network service must publish their changes.
- **Contributing**: Contributions and feedback are welcome! Please check out [`CONTRIBUTING.md`](CONTRIBUTING.md) to get started. Start with a [`good first issue`](https://github.com/dharmeshgurnani/CodeOtter/labels/good%20first%20issue).
- **Code of conduct**: [Contributor Covenant 2.1](CODE_OF_CONDUCT.md).
- **What's next**: [Roadmap](ROADMAP.md) · [Changelog](CHANGELOG.md)
- **Issues**: [Report a bug](https://github.com/dharmeshgurnani/CodeOtter/issues/new?template=bug.yml) · [Request a feature](https://github.com/dharmeshgurnani/CodeOtter/issues/new?template=feature.yml) · [Security policy](SECURITY.md)

<p align="center">
  <a href="https://github.com/dharmeshgurnani/CodeOtter/graphs/contributors"><img src="https://contrib.rocks/image?repo=dharmeshgurnani/CodeOtter" alt="Contributors" /></a>
</p>
