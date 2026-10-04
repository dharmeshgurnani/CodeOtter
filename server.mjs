// pr-scorer: zero-dependency PR quality + blast-radius scorer. `node server.mjs` then open http://localhost:4747
import http from "node:http";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { randomBytes, createHash, createSign } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, createWriteStream, statSync, renameSync, rmSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { join } from "node:path";

// Auto-load .env if present
const ENV_FILE = join(import.meta.dirname, ".env");
if (existsSync(ENV_FILE) && typeof process.loadEnvFile === "function") {
  try { process.loadEnvFile(ENV_FILE); } catch {}
}

const PORT = process.env.PORT || 4747;
// Public address of this app, used for the OAuth callback. Set APP_URL when deployed behind a domain.
// Render and Railway publish the service's own address, so one-click deploys work without setting it.
const APP_URL = (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || (process.env.RAILWAY_PUBLIC_DOMAIN && `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`) || `http://localhost:${PORT}`).replace(/\/+$/, "");
// ponytail: default repo = the git repo you launch from; set REPO to point elsewhere
function forgeOrigin(value) {
  if (!value) return "";
  const u = new URL(String(value).replace(/\/+$/, ""));
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password || u.search || u.hash || u.pathname !== "/") {
    throw new Error("Server URL must be an HTTP(S) origin without credentials, a path, query or fragment");
  }
  if (u.hostname === "github.com") throw new Error("Git servers must use a separate server from github.com");
  return u.origin;
}
const FORGES = {
  forgejo: { label: "Forgejo", pb: "oidc", url: forgeOrigin(process.env.FORGEJO_URL || ""), token: process.env.FORGEJO_TOKEN || "" },
  gitea: { label: "Gitea", pb: "gitea", url: forgeOrigin(process.env.GITEA_URL || ""), token: process.env.GITEA_TOKEN || "" },
};
// Newest published release, refreshed in the background at most every 6 hours. CODEOTTER_UPDATE_CHECK=0 turns it off.
const VERSION = JSON.parse(readFileSync(join(import.meta.dirname, "package.json"), "utf8")).version;
const release = { at: 0, version: "", url: "" };
const newer = (a, b) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };
function availableUpdate() {
  if (process.env.CODEOTTER_UPDATE_CHECK === "0") return null;
  if (Date.now() - release.at > 6 * 3600e3) {
    release.at = Date.now();
    fetch("https://api.github.com/repos/dharmeshgurnani/CodeOtter/releases/latest", { headers: { accept: "application/vnd.github+json", "user-agent": "CodeOtter" }, redirect: "error", signal: AbortSignal.timeout(5000) })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const v = String(j?.tag_name || "").replace(/^v/, "");
        if (/^\d+\.\d+\.\d+$/.test(v)) Object.assign(release, { version: v, url: `https://github.com/dharmeshgurnani/CodeOtter/releases/tag/v${v}` });
      })
      .catch(() => {});
  }
  return release.version && newer(release.version, VERSION) ? { version: release.version, url: release.url } : null;
}
const REPO = process.env.REPO ||(Object.values(FORGES).some((f) => f.url) ? "" : repoFromCwd());
function repoFromCwd() {
  try {
    const ghRepo = execFileSync("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], { encoding: "utf8" }).trim();
    if (ghRepo && REPO_RE.test(ghRepo)) return ghRepo;
  } catch {}
  try {
    const origin = execFileSync("git", ["config", "--get", "remote.origin.url"], { encoding: "utf8" }).trim();
    const m = origin.match(/[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
    if (m && REPO_RE.test(`${m[1]}/${m[2]}`)) return `${m[1]}/${m[2]}`;
  } catch {}
  try {
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname, "package.json"), "utf8"));
    const repoStr = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url || "";
    const m = repoStr.match(/(?:github\.com\/|github:|^)([\w.-]+\/[\w.-]+?)(?:\.git)?$/);
    if (m && REPO_RE.test(m[1])) return m[1];
  } catch {}
  return "dharmeshgurnani/CodeOtter";
}
// Hugging Face organization/author avatars for model & provider selection lists.
const HF_LOGO = "https://huggingface.co/front/assets/huggingface_logo-noborder.svg";
const HF_AVATARS = {
  anthropic: "https://cdn-avatars.huggingface.co/v1/production/uploads/1670531762351-6200d0a443eb0913fa2df7cc.png",
  openai: "https://cdn-avatars.huggingface.co/v1/production/uploads/68783facef79a05727260de3/UPX5RQxiPGA-ZbBmArIKq.png",
  minimax: "https://cdn-avatars.huggingface.co/v1/production/uploads/676e38ad04af5bec20bc9faf/dUd-LsZEX0H_d4qefO_g6.jpeg",
  minimaxai: "https://cdn-avatars.huggingface.co/v1/production/uploads/676e38ad04af5bec20bc9faf/dUd-LsZEX0H_d4qefO_g6.jpeg",
  qwen: "https://cdn-avatars.huggingface.co/v1/production/uploads/6215ca5692c0ecfba9186921/hrRM50-6XcdWgg2AKpENG.jpeg",
  deepseek: "https://cdn-avatars.huggingface.co/v1/production/uploads/6538815d1bdb3c40db94fbfa/xMBly9PUMphrFVMxLX4kq.png",
  "deepseek-ai": "https://cdn-avatars.huggingface.co/v1/production/uploads/6538815d1bdb3c40db94fbfa/xMBly9PUMphrFVMxLX4kq.png",
  microsoft: "https://cdn-avatars.huggingface.co/v1/production/uploads/1583646260758-5e64858c87403103f9f1055d.png",
  mys: "https://cdn-avatars.huggingface.co/v1/production/uploads/1596903074565-noauth.jpeg",
  "meta-llama": "https://cdn-avatars.huggingface.co/v1/production/uploads/646cf8084eefb026fb8fd8bc/oCTqufkdTkjyGodsx1vo1.png",
  meta: "https://cdn-avatars.huggingface.co/v1/production/uploads/646cf8084eefb026fb8fd8bc/oCTqufkdTkjyGodsx1vo1.png",
  google: "https://cdn-avatars.huggingface.co/v1/production/uploads/5dd96eb166059660ed1ee413/WtA3YYitedOr9n02eHfJe.png",
  mistralai: "https://cdn-avatars.huggingface.co/v1/production/uploads/634c17653d11eaedd88b314d/9OgyfKstSZtbmsmuG8MbU.png",
  cohereforai: "https://cdn-avatars.huggingface.co/v1/production/uploads/660eb9ff338e9556c90a6bbc/9DrmMdvUZKoHP3hRTngvc.png",
  cohere: "https://cdn-avatars.huggingface.co/v1/production/uploads/660eb9ff338e9556c90a6bbc/9DrmMdvUZKoHP3hRTngvc.png",
  thudm: "https://cdn-avatars.huggingface.co/v1/production/uploads/63033dc4e1e7f0e03a5e1a31/0BibmRdezvN6v6d2CEtd5.png",
  "01-ai": "https://cdn-avatars.huggingface.co/v1/production/uploads/6536187279f1de44b5e02d0f/-T8Xw0mX67_R73b7Re1y-.png",
  ollama: "https://cdn-avatars.huggingface.co/v1/production/uploads/noauth/MMgt1jNfE_ML3JWg3hz41.png",
  huggingface: "https://cdn-avatars.huggingface.co/v1/production/uploads/1583856921041-5dd96eb166059660ed1ee413.png",
};
function modelIcon(id = "", provider = "") {
  const s = String(id).toLowerCase();
  const p = String(provider).toLowerCase();
  const local = LOCAL[p.replace(/^local_/, "")] || Object.values(LOCAL).find((m) => m.modelId === id || m.repo === id);
  if (local?.icon) return local.icon;
  if (/claude|anthropic/.test(s)) return HF_AVATARS.anthropic;
  if (/^(gpt-|o1|o3|o4|chatgpt)|openai/.test(s)) return HF_AVATARS.openai;
  if (/minimax/.test(s)) return HF_AVATARS.minimax;
  if (/qwen|kev/.test(s)) return HF_AVATARS.qwen;
  if (/deepseek/.test(s)) return HF_AVATARS.deepseek;
  if (/llama/.test(s)) return HF_AVATARS["meta-llama"];
  if (/codereviewer|microsoft|\bphi-/.test(s)) return HF_AVATARS.microsoft;
  if (/gemini|gemma|google/.test(s)) return HF_AVATARS.google;
  if (/mistral|mixtral|codestral/.test(s)) return HF_AVATARS.mistralai;
  if (/command|cohere/.test(s)) return HF_AVATARS.cohere;
  if (/glm|thudm/.test(s)) return HF_AVATARS.thudm;
  if (/laya|typed-decisions|jev|typesafe/.test(s)) return HF_AVATARS.mys;
  if (s.includes("/")) {
    const owner = String(id).split("/")[0];
    return HF_AVATARS[owner.toLowerCase()] || `/api/hf-avatar?owner=${encodeURIComponent(owner)}`;
  }
  if (HF_AVATARS[p]) return HF_AVATARS[p];
  return HF_LOGO;
}
function providerIcon(key) {
  const k = String(key).replace(/^local_/, "");
  if (LOCAL[k]) return LOCAL[k].icon || modelIcon(LOCAL[k].repo, k);
  if (k === "jev" || k === "jev_openrouter") return HF_AVATARS.mys;
  if (k === "openrouter" || k === "custom") return HF_LOGO;
  return HF_AVATARS[k] || HF_LOGO;
}

// Providers. Everything except Anthropic speaks the OpenAI chat/completions shape.
const PROVIDERS = {
  anthropic: { label: "Anthropic", api: "anthropic", baseUrl: "https://api.anthropic.com", models: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-4-5"], keyEnv: "ANTHROPIC_API_KEY", keyUrl: "https://console.anthropic.com/settings/keys" },
  openai: { label: "OpenAI (ChatGPT)", api: "openai", baseUrl: "https://api.openai.com/v1", models: ["gpt-5", "gpt-5-mini", "gpt-4.1"], keyEnv: "OPENAI_API_KEY", keyUrl: "https://platform.openai.com/api-keys" },
  minimax: { label: "MiniMax", api: "openai", baseUrl: "https://api.minimax.io/v1", models: ["MiniMax-M3", "MiniMax-M2.5"], keyEnv: "MINIMAX_API_KEY", keyUrl: "https://platform.minimax.io/user-center/basic-information/interface-key" },
  openrouter: { label: "OpenRouter", api: "openai", baseUrl: "https://openrouter.ai/api/v1", models: ["typesafe/jev-router", "anthropic/claude-sonnet-5", "openai/gpt-5", "qwen/qwen3-coder", "deepseek/deepseek-chat"], keyEnv: "OPENROUTER_API_KEY", keyUrl: "https://openrouter.ai/keys" },
  ollama: { label: "Ollama (local)", api: "openai", baseUrl: "http://localhost:11434/v1", models: ["qwen2.5-coder:latest", "deepseek-coder-v2:latest", "llama3.1:latest"], noKey: true },
  custom: { label: "Custom OpenAI-compatible", api: "openai", baseUrl: "", models: [] },
};
// Defaults come from env (LLM_* keeps working); the Settings page overrides them and persists to the store.
// Live model lists from each provider (10-minute cache). Anthropic and TypeSafe have their own list endpoints;
// everything OpenAI-compatible answers GET /models. Falls back to the static suggestions when a list is unavailable.
const modelCache = new Map();
async function listModels(kind, c) {
  const key = `${kind}|${c.baseUrl}|${(c.apiKey || "").slice(-8)}`;
  const hit = modelCache.get(key);
  if (hit && Date.now() - hit.at < 600e3) return hit.list;
  let list = [];
  const base = (c.baseUrl || "").replace(/\/+$/, "");
  const opt = (headers) => ({ headers, signal: AbortSignal.timeout(10000) });
  try {
    if (kind === "anthropic") {
      const r = await fetch(`${base}/v1/models?limit=1000`, opt({ "x-api-key": c.apiKey, "anthropic-version": "2023-06-01" }));
      if (r.ok) list = ((await r.json()).data || []).map((m) => ({ value: m.id, label: m.display_name ? `${m.display_name} (${m.id})` : m.id, icon: modelIcon(m.id, c.provider) }));
    } else if (kind === "openai") {
      const r = await fetch(`${base}/models`, opt(c.apiKey ? { authorization: `Bearer ${c.apiKey}` } : {}));
      if (r.ok) {
        const d = (await r.json()).data || [];
        list = d
          .filter((m) => m.id && (!m.architecture?.modality || /->text$/.test(m.architecture.modality)) && !/^typesafe\/jev-\d/.test(m.id))
          .map((m) => ({ value: m.id, label: m.id, icon: modelIcon(m.id, c.provider) }))
          .sort((a, b) => a.value.localeCompare(b.value));
      }
    } else if (kind === "s1-typesafe") {
      const r = await fetch(`${base}/v1/models`, opt({ authorization: `Bearer ${c.apiKey}`, accept: "application/json" }));
      if (r.ok) list = ((await r.json()).models || []).map((m) => ({ value: m.id || m, label: m.id || m, icon: modelIcon(m.id || m, c.provider) }));
    } else if (kind === "s1-openrouter") {
      const r = await fetch(`${base}/v1/models`, opt({}));
      if (r.ok) list = ((await r.json()).data || []).filter((m) => /^typesafe\/jev-\d/.test(m.id)).map((m) => ({ value: m.id, label: m.id, icon: modelIcon(m.id, c.provider) }));
    }
  } catch {}
  modelCache.set(key, { list, at: Date.now() });
  return list;
}
const ENV_DEFAULTS = process.env.LLM_BASE_URL
  ? { provider: "custom", baseUrl: process.env.LLM_BASE_URL, model: process.env.LLM_MODEL || "", apiKey: process.env.LLM_API_KEY || "" }
  : { provider: "minimax", baseUrl: PROVIDERS.minimax.baseUrl, model: process.env.LLM_MODEL || "MiniMax-M3", apiKey: process.env.LLM_API_KEY || "" };
// System One models answer typed questions (scores, yes/no gates) in one fast pass; they cannot write prose.
// When one is configured it owns the scores and the merge gates; the language model keeps the narrative
// (summary, walkthrough, findings). Both run in parallel when both are configured.
// Local models (models.json): open-weight System One models served by the `laya` runtime (ggmlc) as a sidecar,
// downloaded with one click into DATA_DIR. Same /v1/systemone contract as Jev, so scoring code does not change.
const CATALOG = JSON.parse(readFileSync(join(import.meta.dirname, "models.json"), "utf8"));
const DATA_DIR = process.env.PR_SCORER_DATA || join(import.meta.dirname, ".local");
const LOCAL = Object.fromEntries(CATALOG.models.map((m) => [m.id, m])); // both kinds: "s1" (typed) and "llm" (chat)
const LOCAL_S1 = CATALOG.models.filter((m) => m.kind === "s1");
// Shown beside small-context System One models wherever they are picked: they read only part of a large pull request.
const contextNote = (m) => (m.kind === "s1" && m.contextTokens < 8192 ? `Reads ${m.contextTokens} tokens (about ${m.contextChars.toLocaleString("en")} characters) per question. On larger pull requests it sees only part of the change, so scores and gates are less accurate.` : "");
const LOCAL_LLM = CATALOG.models.filter((m) => m.kind === "llm");
const S1_PROVIDERS = {
  jev: { label: "TypeSafe Jev", baseUrl: "https://api.typesafe.ai", models: ["jev-latest", "jev-1.13.0"], keyEnv: "TYPESAFE_API_KEY", keyUrl: "https://console.typesafe.ai/settings/keys" },
  // OpenRouter serves the same typed endpoint (POST /api/v1/systemone) with an OpenRouter key
  jev_openrouter: { label: "TypeSafe Jev via OpenRouter", baseUrl: "https://openrouter.ai/api", models: ["typesafe/jev-1.13"], keyEnv: "OPENROUTER_API_KEY", keyUrl: "https://openrouter.ai/keys" },
  ...Object.fromEntries(LOCAL_S1.map((m) => [m.id, { get label() { return modelReady(m) ? `${m.label} (local)` : `${m.label} (local), not downloaded`; }, local: true, baseUrl: "", models: [m.modelId], keyEnv: "" }])),
  custom: { label: "Custom System One endpoint", baseUrl: "", models: [], keyEnv: "", keyUrl: "" },
};
const RUNTIMES = CATALOG.runtimes;
const runtimeAssets = (name) => RUNTIMES[name].assets?.[`${process.platform}-${process.arch}`] || [];
const runtimeDir = (name) => join(DATA_DIR, "runtime", name);
const runtimeBin = (name) => join(runtimeDir(name), process.platform === "win32" ? `${RUNTIMES[name].bin}.exe` : RUNTIMES[name].bin);
const modelPath = (m) => join(DATA_DIR, "models", m.dir || m.file); // a single GGUF, or a directory of checkpoint files
const modelReady = (m) => (m.files ? m.files.every((f) => existsSync(join(modelPath(m), f))) : existsSync(modelPath(m)));
// Local language models (models.json, kind "llm") served by llama-server as a sidecar; same OpenAI chat shape.
for (const m of LOCAL_LLM) PROVIDERS[`local_${m.id}`] = { get label() { return modelReady(m) ? `${m.label} (local)` : `${m.label} (local), not downloaded`; }, api: m.api || "openai", local: m, baseUrl: "", models: [m.modelId], noKey: true };
const fileSize = (p) => (existsSync(p) ? statSync(p).size : 0);

// Downloads with progress and resume. One at a time per target; state readable by the settings page.
const downloads = new Map();
async function downloadFile(url, dest, key) {
  if (downloads.get(key)?.active) return;
  const st = { active: true, done: 0, total: 0, error: "" };
  downloads.set(key, st);
  try {
    mkdirSync(join(dest, ".."), { recursive: true });
    const part = `${dest}.part`;
    const have = fileSize(part);
    const res = await fetch(url, { headers: have ? { range: `bytes=${have}-` } : {}, redirect: "follow", signal: AbortSignal.timeout(3600000) });
    if (!res.ok && res.status !== 206) throw new Error(`Download failed: HTTP ${res.status}`);
    const resumed = res.status === 206;
    st.done = resumed ? have : 0;
    st.total = st.done + Number(res.headers.get("content-length") || 0);
    const out = createWriteStream(part, { flags: resumed ? "a" : "w" });
    const counter = new (class extends (await import("node:stream")).Transform { _transform(chunk, _e, cb) { st.done += chunk.length; cb(null, chunk); } })();
    await pipeline(Readable.fromWeb(res.body), counter, out);
    renameSync(part, dest);
  } catch (e) {
    st.error = e.message;
  } finally {
    st.active = false;
  }
}
// Runtimes: tried in catalog order per platform (e.g. a GPU build first, a CPU build as fallback).
const TAR = process.platform === "win32" && existsSync(join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe")) ? join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe") : "tar";
function findPython() {
  for (const cand of [process.env.PR_SCORER_PYTHON, "python3", "python", "py"].filter(Boolean)) {
    const r = spawnSync(cand, cand === "py" ? ["-3", "-c", "import sys;print(sys.version_info[:2]>=(3,10))"] : ["-c", "import sys;print(sys.version_info[:2]>=(3,10))"], { encoding: "utf8", timeout: 20000, windowsHide: true });
    if (r.status === 0 && /True/.test(r.stdout)) return cand;
  }
  return "";
}
const pyReady = new Set();
const venvPython = (name) => join(runtimeDir(name), "venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
async function ensureRuntime(name) {
  const rt = RUNTIMES[name];
  if (rt.kind === "python") {
    // Python runtime: a private venv with the packages from the catalog. The install shows as a "download" on the page.
    const py = venvPython(name);
    if (pyReady.has(name)) return py;
    if (existsSync(py) && spawnSync(py, ["-c", "import torch, transformers"], { timeout: 120000, windowsHide: true }).status === 0) { pyReady.add(name); return py; }
    const sys = findPython();
    if (!sys) throw new Error("Python 3.10+ is needed for this model and was not found on PATH (set PR_SCORER_PYTHON)");
    const key = `runtime:${name}`;
    if (downloads.get(key)?.active) throw new Error("Runtime install already in progress");
    const st = { active: true, done: 0, total: 0, error: "", label: "Installing Python packages" };
    downloads.set(key, st);
    try {
      mkdirSync(runtimeDir(name), { recursive: true });
      const run = (cmd, args) => new Promise((resolve, reject) => {
        const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
        let log = "";
        p.stdout.on("data", (d) => { log = (log + d).slice(-2000); });
        p.stderr.on("data", (d) => { log = (log + d).slice(-2000); });
        p.on("error", reject);
        p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${args.slice(0, 3).join(" ")} failed: ${log.trim().split("\n").pop()}`))));
      });
      if (!existsSync(py)) await run(sys, sys === "py" ? ["-3", "-m", "venv", join(runtimeDir(name), "venv")] : ["-m", "venv", join(runtimeDir(name), "venv")]);
      st.label = "Installing Python packages (PyTorch, Transformers)";
      await run(py, ["-m", "pip", "install", "--quiet", "--upgrade", "pip"]);
      await run(py, ["-m", "pip", "install", "--quiet", ...rt.pip, ...(rt.pipIndex ? ["--extra-index-url", rt.pipIndex] : [])]);
      pyReady.add(name);
      return py;
    } catch (e) {
      st.error = e.message;
      throw e;
    } finally {
      st.active = false;
    }
  }
  const bin = runtimeBin(name);
  if (existsSync(bin)) return bin;
  const assets = runtimeAssets(name);
  if (!assets.length) throw new Error(`No ${name} runtime for ${process.platform}-${process.arch}; use a hosted model`);
  mkdirSync(runtimeDir(name), { recursive: true });
  let last = "";
  for (const asset of assets) {
    const archive = join(runtimeDir(name), asset);
    try {
      if (!existsSync(archive)) await downloadFile(`${RUNTIMES[name].source}${asset}`, archive, `runtime:${name}`);
      if (downloads.get(`runtime:${name}`)?.error) throw new Error(downloads.get(`runtime:${name}`).error);
      // bsdtar reads zip and tar.gz alike; run from the directory with a relative name so drive letters never look like hosts
      execFileSync(TAR, ["-xf", asset], { cwd: runtimeDir(name) });
      // some archives unpack into a subfolder; hoist the binary and its libraries
      if (!existsSync(bin)) for (const d of readdirSync(runtimeDir(name))) { const inner = join(runtimeDir(name), d, process.platform === "win32" ? `${RUNTIMES[name].bin}.exe` : RUNTIMES[name].bin); if (existsSync(inner)) for (const f of readdirSync(join(runtimeDir(name), d))) renameSync(join(runtimeDir(name), d, f), join(runtimeDir(name), f)); }
      if (existsSync(bin)) return bin;
      last = `${asset} did not contain ${RUNTIMES[name].bin}`;
    } catch (e) {
      last = e.message;
      rmSync(archive, { force: true });
    }
  }
  throw new Error(`Could not install the ${name} runtime: ${last}`);
}
async function downloadModel(m) {
  if (!m.files) return downloadFile(`https://huggingface.co/${m.repo}/resolve/main/${m.file}`, modelPath(m), m.id);
  // several files: one progress entry, files in catalog order (the big one last)
  const st = { active: true, done: 0, total: m.sizeMB * 1e6, error: "" };
  downloads.set(m.id, st);
  try {
    for (const f of m.files) {
      const dest = join(modelPath(m), f);
      if (existsSync(dest)) { st.done += fileSize(dest); continue; }
      const sub = `${m.id}/${f}`;
      const before = st.done;
      const tick = setInterval(() => { const d = downloads.get(sub); if (d) st.done = before + d.done; }, 500);
      await downloadFile(`https://huggingface.co/${m.repo}/resolve/main/${f}`, dest, sub);
      clearInterval(tick);
      const d = downloads.get(sub);
      if (d?.error) throw new Error(d.error);
      st.done = before + fileSize(dest);
    }
  } catch (e) {
    st.error = e.message;
  } finally {
    st.active = false;
  }
}
const localStatus = (m) => {
  const d = downloads.get(m.id);
  const rd = downloads.get(`runtime:${m.runtime}`);
  const sc = sidecars[m.kind];
  if (d?.active) return { state: "downloading", text: `Downloading ${d.total ? Math.round((d.done / d.total) * 100) : 0}% (${Math.round(d.done / 1e6)} of ${d.total ? Math.round(d.total / 1e6) : m.sizeMB} MB)` };
  if (rd?.active && modelReady(m)) return { state: "downloading", text: rd.label || "Installing runtime" };
  if (d?.error) return { state: "error", text: `Download failed: ${d.error}` };
  if (modelReady(m)) return { state: "ready", text: sc.proc && sc.id === m.id ? `Ready · running on ${sc.device || "local"}` : "Ready" };
  return { state: "missing", text: `Not downloaded (${m.sizeMB} MB, ${m.license})` };
};

// One sidecar per kind (typed engine on 47110, language model on 47120). Started on first use, stopped after 15 idle minutes.
const sidecars = {
  s1: { proc: null, id: null, port: 47110, ready: false, device: "", lastUse: 0, starting: null },
  llm: { proc: null, id: null, port: 47120, ready: false, device: "", lastUse: 0, starting: null },
};
function stopSidecar(kind) {
  const sc = sidecars[kind];
  if (sc.proc) { try { sc.proc.kill(); } catch {} }
  Object.assign(sc, { proc: null, id: null, ready: false, device: "", starting: null });
}
const stopSidecars = () => { stopSidecar("s1"); stopSidecar("llm"); };
// The runtime's "auto" device takes Vulkan device 0, which on laptops is often the integrated GPU. Read the device list
// from `laya info` once and prefer a discrete GPU. S1_DEVICE overrides (cpu, vulkan:1, cuda, metal ...).
// Vulkan device index of a discrete GPU (laptops list the integrated one first). Cached; S1_DEVICE / LLM_DEVICE override.
let gpuIndex = null;
function discreteGpu(bin, m) {
  if (gpuIndex !== null) return gpuIndex;
  const r = spawnSync(bin, ["info", modelPath(m), "--device", "auto"], { encoding: "utf8", timeout: 120000, windowsHide: true });
  const out = String(r.stdout || "") + String(r.stderr || "");
  const devs = [...out.matchAll(/ggml_vulkan: (\d+) = ([^|\n]+)/g)].map((x) => ({ i: Number(x[1]), name: x[2].trim() }));
  const discrete = devs.find((d) => /nvidia|geforce|radeon|amd|\barc\b/i.test(d.name) && !/intel\(r\) (uhd|iris)/i.test(d.name));
  gpuIndex = discrete ? discrete.i : -1;
  return gpuIndex;
}
function discreteGpuLlama(bin) {
  if (gpuIndex !== null) return gpuIndex;
  const r = spawnSync(bin, ["--list-devices"], { encoding: "utf8", timeout: 60000, windowsHide: true });
  const out = String(r.stdout || "") + String(r.stderr || "");
  const devs = [...out.matchAll(/Vulkan(\d+): ([^(\n]+)/g)].map((x) => ({ i: Number(x[1]), name: x[2].trim() }));
  const discrete = devs.find((d) => /nvidia|geforce|radeon|amd|\barc\b/i.test(d.name) && !/intel\(r\) (uhd|iris)/i.test(d.name));
  gpuIndex = discrete ? discrete.i : -1;
  return gpuIndex;
}
function sidecarArgs(m, bin, port) {
  if (RUNTIMES[m.runtime].kind === "python") return [join(import.meta.dirname, RUNTIMES[m.runtime].script), "--model", modelPath(m), "--port", String(port), "--device", process.env.LLM_DEVICE || "auto"];
  if (m.runtime === "laya") {
    const dev = process.env.S1_DEVICE || (discreteGpu(bin, m) >= 0 ? `vulkan:${gpuIndex}` : "auto");
    return ["serve", modelPath(m), "--port", String(port), "--device", dev];
  }
  // llama-server: OpenAI-compatible chat at /v1/chat/completions
  const args = ["-m", modelPath(m), "--host", "127.0.0.1", "--port", String(port), "-c", String(m.contextTokens || 8192), "-ngl", "99"];
  const dev = process.env.LLM_DEVICE || (discreteGpuLlama(bin) >= 0 ? `Vulkan${gpuIndex}` : "");
  if (dev === "cpu") args.push("-ngl", "0");
  else if (dev) args.push("--device", dev);
  return args;
}
async function ensureSidecar(m) {
  const sc = sidecars[m.kind];
  if (sc.proc && sc.id === m.id && sc.ready) { sc.lastUse = Date.now(); return sc.port; }
  if (sc.starting && sc.id === m.id) return sc.starting;
  stopSidecar(m.kind);
  const bin = await ensureRuntime(m.runtime);
  if (!modelReady(m)) throw new Error(`${m.label} is not downloaded: open Settings / Local models`);
  sc.id = m.id;
  sc.starting = (async () => {
    const proc = spawn(bin, sidecarArgs(m, bin, sc.port), { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, cwd: RUNTIMES[m.runtime].kind === "python" ? import.meta.dirname : runtimeDir(m.runtime) });
    sc.proc = proc;
    let log = "";
    proc.stderr.on("data", (d) => { log = (log + d).slice(-4000); });
    proc.stdout.on("data", (d) => { log = (log + d).slice(-4000); });
    proc.on("exit", () => { if (sc.proc === proc) Object.assign(sc, { proc: null, ready: false, starting: null }); });
    for (let i = 0; i < 300; i++) {
      if (!sc.proc) throw new Error(`Local model runtime exited: ${log.trim().split("\n").pop() || "no output"}`);
      try {
        const h = await (await fetch(`http://127.0.0.1:${sc.port}/health`, { signal: AbortSignal.timeout(2000) })).json();
        if (h.status === "ok") { sc.ready = true; sc.device = h.device || (m.runtime === "llama" ? (gpuIndex >= 0 ? `Vulkan${gpuIndex}` : "cpu") : ""); sc.lastUse = Date.now(); sc.starting = null; return sc.port; }
      } catch {}
      await new Promise((r) => setTimeout(r, 1000));
    }
    stopSidecar(m.kind);
    throw new Error("Local model runtime did not become ready in time");
  })();
  return sc.starting;
}
// Auto triage: every two minutes, each open pull request in an onboarded repository whose head moved since its last triage gets one.
let triagePolling = false;
setInterval(async () => {
  if (triagePolling) return;
  triagePolling = true;
  try {
    if (!(await triageConfig()).auto) return;
    const done = (await store.getSetting("triageResults")) || {};
    for (const repo of await repos()) {
      for (const p of await openPrs(repo)) {
        if (!SHA_RE.test(p.headRefOid || "") || done[p.url]?.headSha === p.headRefOid) continue;
        await triagePr(p.url, repo).catch((e) => console.warn(`[triage] ${p.url}: ${e.message}`));
      }
    }
  } catch (e) {
    console.warn(`[triage] ${e.message}`);
  } finally {
    triagePolling = false;
  }
}, 120e3).unref();
setInterval(() => { for (const k of ["s1", "llm"]) { const sc = sidecars[k]; if (sc.proc && sc.ready && Date.now() - sc.lastUse > 15 * 60e3) stopSidecar(k); } }, 60e3).unref();
process.on("exit", stopSidecars);

async function s1Config() {
  const saved = (await store.getSetting("s1")) || {};
  const provider = saved.provider || (process.env.TYPESAFE_API_KEY ? "jev" : "none");
  const p = S1_PROVIDERS[provider];
  if (!p) return { provider: "none", model: "", baseUrl: "", apiKey: "", enabled: false };
  if (p.local) {
    const m = LOCAL[provider];
    return { provider, local: m, model: m.modelId, baseUrl: "", apiKey: "", contextChars: m.contextChars, enabled: modelReady(m) };
  }
  const apiKey = saved.apiKey || (p.keyEnv && process.env[p.keyEnv]) || "";
  const baseUrl = saved.baseUrl || p.baseUrl;
  return { provider, model: saved.model || p.models[0] || "", baseUrl, apiKey, enabled: provider === "custom" ? !!baseUrl : !!apiKey };
}
async function askSystemOne(state, questions, c, onChunk) {
  if (!c.enabled) throw new Error(c.local ? `${c.local.label} is not downloaded: open Settings / Local models` : "No System One model configured: open Settings");
  const base = c.local ? `http://127.0.0.1:${await ensureSidecar(c.local)}` : c.baseUrl.replace(/\/+$/, "");
  const max = onChunk ? Math.min(c.local?.maxQuestions || 2, 2) : c.local?.maxQuestions || 0;
  const keys = Object.keys(questions);
  if (max && keys.length > max) {
    // the runtime answers at most `max` questions per request; ask in chunks, merge, and stream partial answers
    const answers = {};
    for (let i = 0; i < keys.length; i += max) {
      const part = Object.fromEntries(keys.slice(i, i + max).map((k) => [k, questions[k]]));
      Object.assign(answers, await askSystemOne(state, part, c));
      onChunk?.(answers);
    }
    return answers;
  }
  const res = await fetch(`${base}/v1/systemone`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", ...(c.apiKey ? { authorization: `Bearer ${c.apiKey}` } : {}) },
    body: JSON.stringify({ model: c.model, state, questions }),
    signal: AbortSignal.timeout(c.local ? 300000 : 60000),
  });
  if (!res.ok) throw new Error(`${S1_PROVIDERS[c.provider]?.label || c.provider} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const ans = (await res.json()).answers || {};
  onChunk?.(ans);
  return ans;
}

async function llmConfig() {
  const saved = (await store.getSetting("llm")) || {};
  const provider = saved.provider || ENV_DEFAULTS.provider;
  const p = PROVIDERS[provider] || PROVIDERS.custom;
  const isEnv = provider === ENV_DEFAULTS.provider;
  if (p.local) return { provider, api: p.local.api || "openai", local: p.local, baseUrl: "", model: p.local.modelId, apiKey: "", contextChars: p.local.contextChars, enabled: modelReady(p.local), source: "settings" };
  return {
    provider,
    api: p.api,
    baseUrl: saved.baseUrl || (isEnv ? ENV_DEFAULTS.baseUrl : p.baseUrl),
    model: saved.model || (isEnv ? ENV_DEFAULTS.model : p.models[0] || ""),
    apiKey: saved.apiKey || (p.keyEnv && process.env[p.keyEnv]) || (isEnv ? ENV_DEFAULTS.apiKey : ""),
    source: saved.provider ? "settings" : "env",
  };
}

// Store: PocketBase when PB_URL is set (the Docker image sets it, or auto-detected locally), plain JSON files in scores/ otherwise.
function findPocketBase() {
  const isWin = process.platform === "win32";
  const binaryName = isWin ? "pocketbase.exe" : "pocketbase";
  const candidates = [
    join(import.meta.dirname, ".pb", binaryName),
    join(import.meta.dirname, binaryName),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  try {
    const cmd = isWin ? "where.exe" : "which";
    const out = execFileSync(cmd, ["pocketbase"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split(/\r?\n/)[0];
    if (out && existsSync(out)) return out;
  } catch {}
  return "";
}

const pbBinAvailable = findPocketBase();
const PB_URL = process.env.PB_URL || (pbBinAvailable ? "http://127.0.0.1:8090" : "");
const SCORES = join(import.meta.dirname, "scores");
const CONFIG = join(import.meta.dirname, "config.json");
const readConfig = () => (existsSync(CONFIG) ? JSON.parse(readFileSync(CONFIG, "utf8")) : {});
const keyOf = (url) => /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/.test(url)
  ? url.replace("https://github.com/", "").replace(/\//g, "-")
  : createHash("sha256").update(url).digest("hex");
const fileStore = {
  init: async () => mkdirSync(SCORES, { recursive: true }),
  get: async (url) => {
    const f = join(SCORES, `${keyOf(url)}.json`);
    return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null;
  },
  put: async (r) => writeFileSync(join(SCORES, `${keyOf(r.pr.url)}.json`), JSON.stringify(r, null, 2)),
  getSetting: async (key) => readConfig()[key] ?? null,
  setSetting: async (key, value) => writeFileSync(CONFIG, JSON.stringify({ ...readConfig(), [key]: value }, null, 2)),
  all: async () =>
    (existsSync(SCORES) ? readdirSync(SCORES) : [])
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(join(SCORES, f), "utf8")))
      .sort((a, b) => b.at.localeCompare(a.at)),
  reviews() {
    return this.all();
  },
};

let pbProc = null;
async function ensurePocketBase() {
  if (!PB_URL) return;
  const pbBin = findPocketBase();
  // Check if PocketBase is already running
  const reachable = await fetch(`${PB_URL}/api/health`, { signal: AbortSignal.timeout(1000) })
    .then((r) => r.ok)
    .catch(() => false);
  if (reachable) return;
  if (!pbBin) return;

  const dir = join(import.meta.dirname, "pb_data");
  const migrationsDir = join(import.meta.dirname, "pb_migrations");
  mkdirSync(dir, { recursive: true });

  const adminEmail = process.env.PB_ADMIN_EMAIL || "admin@example.com";
  const adminPassword = process.env.PB_ADMIN_PASSWORD || "change-me-please";

  try {
    execFileSync(pbBin, ["superuser", "upsert", adminEmail, adminPassword, "--dir", dir, "--migrationsDir", migrationsDir], { stdio: "ignore" });
  } catch {}

  const url = new URL(PB_URL);
  const hostPort = `${url.hostname}:${url.port || "8090"}`;
  pbProc = spawn(pbBin, ["serve", `--http=${hostPort}`, "--dir", dir, "--migrationsDir", migrationsDir], { stdio: "ignore", detached: false });

  const killPb = () => { if (pbProc) { try { pbProc.kill(); } catch {} pbProc = null; } };
  process.on("exit", killPb);
  process.on("SIGINT", () => { killPb(); process.exit(); });
  process.on("SIGTERM", () => { killPb(); process.exit(); });

  for (let i = 0; i < 20; i++) {
    const ok = await fetch(`${PB_URL}/api/health`, { signal: AbortSignal.timeout(1000) })
      .then((r) => r.ok)
      .catch(() => false);
    if (ok) {
      console.log(`PocketBase auto-started at ${PB_URL}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

let pbToken = "";
async function pbAuth() {
  const adminEmail = process.env.PB_ADMIN_EMAIL || "admin@example.com";
  const adminPassword = process.env.PB_ADMIN_PASSWORD || "change-me-please";
  const res = await fetch(`${PB_URL}/api/collections/_superusers/auth-with-password`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identity: adminEmail, password: adminPassword }),
  });
  if (!res.ok) throw new Error(`PocketBase auth ${res.status}: ${(await res.text()).slice(0, 300)}`);
  pbToken = (await res.json()).token;
}
async function pb(path, init = {}, retry = true) {
  const res = await fetch(`${PB_URL}/api/${path}`, { ...init, headers: { "content-type": "application/json", authorization: pbToken }, signal: AbortSignal.timeout(10000) });
  if (res.status === 401 && retry) return pbAuth().then(() => pb(path, init, false));
  if (!res.ok) throw new Error(`Storage ${res.status}: ${pbError(await res.text())}`);
  return res.json();
}
// PocketBase validation errors nest as {data:{field:{sub:{code,message}}}}; surface "field.sub: message".
function pbError(text) {
  try {
    const j = JSON.parse(text);
    const leaves = (o, path = []) => (o && typeof o === "object" && !("code" in o) ? Object.entries(o).flatMap(([k, v]) => leaves(v, [...path, k])) : [[path.join("."), o?.message]]);
    const [first] = leaves(j.data || {});
    return j.message + (first?.[1] ? ` ${first[0]}: ${first[1]}` : "");
  } catch {
    return text.slice(0, 300);
  }
}
const pbFind = async (url) => (await pb(`collections/reviews/records?perPage=1&filter=${encodeURIComponent(`url="${url}"`)}`)).items[0];
const pbStore = {
  async init() {
    await ensurePocketBase();
    for (let i = 0; ; i++) {
      try {
        await pbAuth();
        break;
      } catch (e) {
        if (i >= 30) throw new Error(`Cannot reach PocketBase at ${PB_URL} (check PB_URL, PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD): ${e.message}`);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    // one-off import of reviews left in scores/ from before PocketBase
    for (const r of await fileStore.all()) if (!(await pbFind(r.pr.url))) await this.put(r);
  },
  get: async (url) => (await pbFind(url))?.data ?? null,
  async put(r) {
    const body = JSON.stringify({ url: r.pr.url, repo: repoOf(r.pr), number: r.pr.number, title: r.pr.title, verdict: r.review.verdict, quality: r.review.scores.quality, blast: r.blast.score, model: r.model, at: r.at, data: r });
    const hit = await pbFind(r.pr.url);
    await pb(hit ? `collections/reviews/records/${hit.id}` : "collections/reviews/records", { method: hit ? "PATCH" : "POST", body });
  },
  all: async () => (await pb("collections/reviews/records?perPage=500&sort=-at")).items.map((i) => i.data),
  reviews() {
    return this.all();
  },
  getOAuth: async () => (await pb("collections/users")).oauth2,
  hasForgeIdentities: async (provider) => (await pb(`collections/_externalAuths/records?perPage=1&filter=${encodeURIComponent(`provider="${provider}"`)}`)).items.length > 0,
  // Sign-in: PocketBase's manual OAuth2 flow. No superuser token involved; these are public user endpoints.
  authMethods: async () => (await fetch(`${PB_URL}/api/collections/users/auth-methods`)).json(),
  async authWithOAuth2(body) {
    const res = await fetch(`${PB_URL}/api/collections/users/auth-with-oauth2`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`Sign-in failed: ${pbError(await res.text())}`);
    return res.json();
  },
  async authRefresh(token) {
    const res = await fetch(`${PB_URL}/api/collections/users/auth-refresh`, { method: "POST", headers: { authorization: token } });
    return res.ok ? res.json() : null;
  },
  userFile: (id, file) => fetch(`${PB_URL}/api/files/users/${id}/${file}`),
  users: async () => (await pb("collections/users/records?perPage=200&sort=created")).items,
  setRole: (id, role) => pb(`collections/users/records/${id}`, { method: "PATCH", body: JSON.stringify({ role }) }),
  setOAuth: async (oauth2) => pb("collections/users", { method: "PATCH", body: JSON.stringify({ oauth2 }) }),
  getSetting: async (key) => (await pb(`collections/settings/records?perPage=1&filter=${encodeURIComponent(`key="${key}"`)}`)).items[0]?.value ?? null,
  async setSetting(key, value) {
    const hit = (await pb(`collections/settings/records?perPage=1&filter=${encodeURIComponent(`key="${key}"`)}`)).items[0];
    await pb(hit ? `collections/settings/records/${hit.id}` : "collections/settings/records", { method: hit ? "PATCH" : "POST", body: JSON.stringify({ key, value }) });
  },
};
const store = PB_URL ? pbStore : fileStore;

// GitHub CLI. stderr is captured so "gh auth login" / "Not Found" reach the UI instead of the terminal.
const gh = (...rawArgs) => {
  const args = Array.isArray(rawArgs[0]) ? rawArgs[0] : rawArgs;
  try {
    return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    throw new Error(`gh ${args.slice(0, 2).join(" ")}: ${String(e.stderr || e.message).trim().split("\n")[0] || "failed"}`);
  }
};
const ghAsync = (...rawArgs) => {
  const args = Array.isArray(rawArgs[0]) ? rawArgs[0] : rawArgs;
  return new Promise((resolve, reject) => {
    const p = spawn("gh", args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { err += d; });
    p.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`gh ${args.slice(0, 2).join(" ")}: ${String(err).trim().split("\n")[0] || "failed"}`));
    });
  });
};
const OWNER_RE = /^(?:(?:forgejo|gitea)~)?[\w][\w.-]*$/;
const REPO_RE = /^(?:(?:forgejo|gitea)~)?[\w][\w.-]*\/[\w][\w.-]*$/;
const forgeId = (repo) => /^(forgejo|gitea)~/.exec(String(repo))?.[1] || "";
const isForgeRepo = (repo) => !!forgeId(repo);
const nativeRepo = (repo) => String(repo).replace(/^(forgejo|gitea)~/, "");
const repoLabel = (repo) => isForgeRepo(repo) ? `${nativeRepo(repo)} · ${FORGES[forgeId(repo)].label}` : repo;
const forgeUrl = (repo) => isForgeRepo(repo) ? FORGES[forgeId(repo)].url : "https://github.com";
const prUrlFor = (repo, number) => `${forgeUrl(repo)}/${nativeRepo(repo)}/${isForgeRepo(repo) ? "pulls" : "pull"}/${number}`;
function parsePrUrl(value) {
  try {
    const u = new URL(value);
    if (u.username || u.password || u.search || u.hash) return null;
    const source = Object.keys(FORGES).find((id) => FORGES[id].url && u.origin === FORGES[id].url);
    const fj = !!source;
    if (!fj && u.origin !== "https://github.com") return null;
    const m = u.pathname.match(fj ? /^\/([\w][\w.-]*\/[\w][\w.-]*)\/pulls\/([1-9]\d*)$/ : /^\/([\w][\w.-]*\/[\w][\w.-]*)\/pull\/([1-9]\d*)$/);
    if (!m || value !== `${u.origin}${u.pathname}`) return null;
    return { repo: `${source ? `${source}~` : ""}${m[1]}`, number: Number(m[2]), selfHosted: fj };
  } catch { return null; }
}
const validPrUrl = (value) => !!parsePrUrl(value);
function cleanRepo(value, org = "") {
  const s = String(value).trim().replace(/\/+$/, "");
  for (const [id, f] of Object.entries(FORGES)) if (f.url && s.startsWith(`${f.url}/`)) return `${id}~${s.slice(f.url.length + 1)}`;
  if (isForgeRepo(org) && !isForgeRepo(s) && REPO_RE.test(s)) return `${forgeId(org)}~${s}`;
  return s.replace(/^https:\/\/github\.com\//, "");
}

// Only operator-configured origins receive the token. Never follow upstream redirects.
async function forgeApi(path, { method = "GET", body, raw = false, source = forgeId(path.replace(/^repos\//, "")) } = {}) {
  const f = FORGES[source];
  if (!f) throw new Error("Missing git server provider");
  path = path.replace(/^repos\/(forgejo|gitea)~/, "repos/");
  if (!f.url || !/^(?:user$|(?:repos|user|users|orgs)\/)/.test(path) || path.split(/[/?]/).some((p) => p === "." || p === "..")) throw new Error("Invalid git server API path");
  if (!f.token) throw new Error(`Configure an access token in Admin / OAuth / ${f.label} connection`);
  const res = await fetch(`${f.url}/api/v1/${path}`, {
    method, redirect: "error", signal: AbortSignal.timeout(30000),
    headers: { authorization: `token ${f.token}`, accept: raw ? "text/plain" : "application/json", ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw Object.assign(new Error(`${f.label} ${method} ${path.split("?")[0]} failed (${res.status})`), { status: res.status });
  if (res.status === 204) return null;
  return raw ? res.text() : res.json();
}

async function forgeList(path, source = forgeId(path.replace(/^repos\//, ""))) {
  const rows = [];
  // Request one extra page even when the server caps limit below 50.
  for (let page = 1; page <= 1000; page++) {
    const batch = await forgeApi(`${path}${path.includes("?") ? "&" : "?"}limit=50&page=${page}`, { source });
    if (!Array.isArray(batch)) throw new Error("Invalid git server list response");
    if (!batch.length) return rows;
    rows.push(...batch);
  }
  throw new Error("Git server pagination limit exceeded");
}

function normalizeForgePr(p, repo, files = [], commits = []) {
  return {
    number: p.number, title: p.title, body: p.body || "", url: prUrlFor(repo, p.number),
    author: { login: p.user?.login || "unknown" }, updatedAt: p.updated_at,
    baseRefName: p.base?.ref || "", headRefName: p.head?.ref || "", headRefOid: p.head?.sha || "",
    // Fork head content lives in the fork, not in the base repository's branch namespace.
    headRepo: p.head?.repo?.full_name ? `${forgeId(repo)}~${p.head.repo.full_name}` : repo,
    additions: p.additions ?? files.reduce((n, f) => n + f.additions, 0),
    deletions: p.deletions ?? files.reduce((n, f) => n + f.deletions, 0), changedFiles: p.changed_files ?? files.length,
    state: p.merged ? "MERGED" : String(p.state || "open").toUpperCase(), files, commits,
  };
}

async function readPr(url, spec, diff = false) {
  const parsed = parsePrUrl(url);
  if (!parsed) throw new Error("Invalid pull request URL");
  if (!parsed.selfHosted) return ghAsync("pr", diff ? "diff" : "view", ...spec, ...(diff ? [] : ["--json", "number,title,body,author,url,baseRefName,headRefName,headRefOid,additions,deletions,changedFiles,files,commits,state"]));
  const { repo, number } = parsed;
  const path = `repos/${repo}/pulls/${number}`;
  if (diff) return forgeApi(`${path}.diff`, { raw: true });
  const [p, files, commits] = await Promise.all([forgeApi(path), forgeList(`${path}/files`), forgeList(`${path}/commits`)]);
  if (commits.length && !commits.some((c) => c.sha === p.head?.sha)) {
    throw new Error("The git server is updating this pull request after a push. Retry the review shortly.");
  }
  return JSON.stringify(normalizeForgePr(p, repo,
    files.map((f) => ({ path: f.filename, additions: Number(f.additions) || 0, deletions: Number(f.deletions) || 0 })),
    // Forgejo/Gitea return newest first; the shared incremental engine expects oldest first.
    commits.reverse().map((c) => ({ oid: c.sha, messageHeadline: (c.commit?.message || "").split("\n")[0], messageBody: (c.commit?.message || "").split("\n").slice(1).join("\n"), authors: [{ login: c.author?.login || c.commit?.author?.name || "" }], committedDate: c.commit?.author?.date }))));
}

const createPrComment = (url, repo, number, body) => isForgeRepo(repo)
  ? forgeApi(`repos/${repo}/issues/${number}/comments`, { method: "POST", body: { body } })
  : ghAsync("pr", "comment", url, "--body", body);

const HOTSPOTS = [
  ["migrations", /(^|\/)migrations\//i],
  ["auth / security", /auth|acl|permission|middleware|secret|token/i],
  ["payments / money", /payment|invoice|billing|stripe|fee/i],
  ["public API routes", /(^|\/)(api|routes)\//i],
  ["core domain", /\bcore\//],
  ["dependencies", /package\.json|pnpm-lock\.yaml|yarn\.lock|package-lock\.json|go\.sum|Cargo\.lock/],
  ["CI / deploy", /\.github\/|railway\.json|Dockerfile|docker-compose|\.gitlab-ci/],
];

function extractChangedSymbols(diff) {
  const symbols = new Set();
  const defRegexes = [
    /(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z0-9_$]+)/g,
    /(?:export\s+)?(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[a-zA-Z0-9_$]+)\s*=>/g,
    /(?:export\s+)?class\s+([a-zA-Z0-9_$]+)/g,
    /(?:export\s+)?(?:type|interface)\s+([a-zA-Z0-9_$]+)/g,
    /def\s+([a-zA-Z0-9_]+)\s*\(/g,
    /func\s+(?:\([^)]+\)\s*)?([a-zA-Z0-9_]+)\s*\(/g,
    /fn\s+([a-zA-Z0-9_]+)\s*\(/g,
  ];
  const ignore = new Set([
    "string", "number", "boolean", "const", "let", "var", "export", "import",
    "return", "true", "false", "null", "undefined", "async", "await", "default",
    "class", "function", "if", "else", "for", "while", "switch", "case", "break",
    "then", "catch", "finally", "try", "new", "this", "super", "typeof", "void"
  ]);

  for (const line of diff.split("\n")) {
    if ((line.startsWith("+") || line.startsWith("-")) && !line.startsWith("+++") && !line.startsWith("---")) {
      const code = line.slice(1);
      for (const re of defRegexes) {
        for (const match of code.matchAll(re)) {
          const sym = match[1];
          if (sym && sym.length >= 3 && !ignore.has(sym)) {
            symbols.add(sym);
          }
        }
      }
    }
  }
  return [...symbols].slice(0, 15);
}

async function sliceOutsideDiffImpact(repo, diff, changedFiles = []) {
  const symbols = extractChangedSymbols(diff);
  // The working directory is CodeOtter, not a checkout of a remote Forgejo/Gitea PR.
  if (isForgeRepo(repo)) return { symbols, callers: [], outsideCallers: 0, uniqueFiles: 0, formatted: "" };
  if (!symbols.length) return { symbols: [], callers: [], outsideCallers: 0, uniqueFiles: 0, formatted: "" };

  const changedSet = new Set(changedFiles.map((f) => f.replace(/\\/g, "/")));
  const callers = [];
  const excludeArgs = changedFiles.flatMap((f) => [":!" + f, ":!" + f.replace(/\\/g, "/")]);

  // 1. Local git grep (instant, zero-network)
  for (const sym of symbols) {
    try {
      const raw = execFileSync("git", ["grep", "-n", "-w", sym, "--", ".", ...excludeArgs], {
        encoding: "utf8",
        timeout: 4000,
        maxBuffer: 4 << 20,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const lines = raw.split("\n").filter(Boolean);
      for (const line of lines.slice(0, 5)) {
        const parts = line.split(":");
        if (parts.length >= 3) {
          const file = parts[0].replace(/\\/g, "/");
          const lineNum = parseInt(parts[1], 10);
          const snippet = parts.slice(2).join(":").trim();
          if (!changedSet.has(file) && !/\.(lock|map|min\.js|svg|png|json)$/i.test(file)) {
            callers.push({ symbol: sym, file, line: lineNum, snippet: snippet.slice(0, 140) });
          }
        }
      }
    } catch {}
    if (callers.length >= 12) break;
  }

  // 2. Remote GitHub code search fallback if no local git hits
  if (callers.length === 0 && repo && REPO_RE.test(repo)) {
    for (const sym of symbols.slice(0, 3)) {
      try {
        const raw = await ghAsync("api", `search/code?q=repo:${repo}+${encodeURIComponent(sym)}&per_page=5`).catch(() => "");
        if (raw) {
          const data = JSON.parse(raw);
          for (const item of data.items || []) {
            const f = item.path;
            if (!changedSet.has(f) && !/\.(lock|map|min\.js|svg|png|json)$/i.test(f)) {
              callers.push({ symbol: sym, file: f, line: 1, snippet: `reference to ${sym}` });
            }
          }
        }
      } catch {}
      if (callers.length >= 10) break;
    }
  }

  const uniqueFiles = new Set(callers.map((c) => c.file));
  let formatted = "";
  if (callers.length > 0) {
    formatted = `Outside-Diff Call Graph Context (Smart Context - ${callers.length} outside call-site(s) across ${uniqueFiles.size} un-modified file(s)):\n` +
      `The following files outside this pull request call or reference symbols modified in the diff. MANDATORY: Verify contract compatibility (parameter orders/types, return object structure, newly thrown/raised exceptions) to prevent silent production regressions:\n` +
      callers.map((c) => `- [${c.file}:${c.line}] calls '${c.symbol}': \`${c.snippet}\``).join("\n");
  }

  return { symbols, callers, outsideCallers: callers.length, uniqueFiles: uniqueFiles.size, formatted };
}

function blastRadius(files, outsideCallers = 0, outsideFiles = 0) {
  const lines = files.reduce((n, f) => n + f.additions + f.deletions, 0);
  const dirs = new Set(files.map((f) => f.path.split("/").slice(0, 3).join("/")));
  const hot = HOTSPOTS.filter(([, re]) => files.some((f) => re.test(f.path))).map(([n]) => n);
  const tests = files.filter((f) => /test|spec|__tests__/.test(f.path)).length;
  // Upgraded with real outside-diff call-graph fan-out (Smart Context impact slicing)
  const callerImpact = Math.min(25, outsideCallers * 4 + outsideFiles * 2);
  const score = Math.min(100, Math.min(30, files.length * 2.5) + Math.min(25, lines / 30) + Math.min(25, hot.length * 10) + callerImpact);
  return { score: Math.round(score), files: files.length, lines, dirs: dirs.size, hotspots: hot, testFiles: tests, outsideCallers, outsideFiles };
}

// One prompt in, text out. Anthropic uses the Messages API; everyone else is OpenAI chat/completions.
async function askModel(prompt, c) {
  if (!c.model) throw new Error("No model configured: open Settings");
  if (c.local && !c.enabled) throw new Error(`${c.local.label} is not downloaded: open Settings / Local models`);
  if (!c.local && !c.apiKey && !PROVIDERS[c.provider]?.noKey && !/localhost|127\.0\.0\.1/.test(c.baseUrl)) throw new Error(`No API key for ${PROVIDERS[c.provider]?.label || c.provider}: open Settings`);
  const base = c.local ? `http://127.0.0.1:${await ensureSidecar(c.local)}/v1` : c.baseUrl.replace(/\/+$/, "");
  if (c.api === "codereviewer") {
    // No chat endpoint: the test sends one hunk through /v1/review and reports the comment.
    const res = await fetch(`${base}/review`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ hunks: [{ file: "src/math.js", diff: [" function add(a, b) {", "-  return a + b;", "+  return a - b;", " }", ""].join("\n") }] }), signal: AbortSignal.timeout(300000) });
    if (!res.ok) throw new Error(`CodeReviewer ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const { comments } = await res.json();
    return `OK: ${String(comments?.[0]?.comment || "").trim() || "(no comment)"}`;
  }
  if (c.api === "anthropic") {
    const res = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": c.apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: c.model, max_tokens: 16000, ...(/^claude-(opus|sonnet|fable)-5/.test(c.model) ? { output_config: { effort: "high" } } : {}), messages: [{ role: "user", content: prompt }] }),
      signal: AbortSignal.timeout(600000),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const msg = await res.json();
    if (msg.stop_reason === "refusal") throw new Error(`Anthropic declined the request (${msg.stop_details?.category || "refusal"})`);
    if (msg.stop_reason === "max_tokens") throw new Error("Anthropic response was cut off at max_tokens: the review is incomplete");
    return msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  }
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(c.apiKey ? { authorization: `Bearer ${c.apiKey}` } : {}) },
    body: JSON.stringify({ model: c.model, temperature: c.temperature ?? 0.2, messages: [{ role: "user", content: prompt }] }),
    signal: AbortSignal.timeout(c.local ? 900000 : 180000),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()).choices[0].message.content.replace(/<think>[\s\S]*?<\/think>/g, "");
}

const REVIEW_DEFAULTS = { maxFindings: 8, diffChars: 90000, contextLines: 16, reflectMin: 5, temperature: 0.2, postScores: false, postReview: false, postInlineSuggestions: false, commands: false };
const reviewConfig = async () => ({ ...REVIEW_DEFAULTS, ...((await store.getSetting("review")) || {}) });

// Repository review guides: AGENTS.md and/or CLAUDE.md at the repo root (both are used when both exist, since one is
// often a stub pointing at the other). Detection is cached for 10 minutes; whether guides are used is a per-repository
// setting ("guides": { "owner/name": { use: bool } }), defaulting to on when found.
const GUIDE_FILES = ["AGENTS.md", "CLAUDE.md"];
const GUIDE_CHARS = 20000;
const guideCache = new Map();
async function guideFiles(repo, ref = "") {
  const cacheKey = `${repo}@${ref}`;
  const hit = guideCache.get(cacheKey);
  if (hit && Date.now() - hit.at < 600e3) return hit.files;
  if (isForgeRepo(repo)) {
    const files = [];
    for (const file of GUIDE_FILES) {
      try {
        await forgeApi(`repos/${repo}/contents/${file}${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`);
        files.push(file);
      } catch (e) { if (e.status !== 404) throw e; }
    }
    guideCache.set(cacheKey, { files, at: Date.now() });
    return files;
  }
  const files = GUIDE_FILES.filter((f) => {
    try {
      if (ref) {
        try {
          gh("api", `repos/${repo}/contents/${f}?ref=${encodeURIComponent(ref)}`, "--jq", ".name");
          return true;
        } catch {}
      }
      gh("api", `repos/${repo}/contents/${f}`, "--jq", ".name");
      return true;
    } catch {
      return repo === REPO && existsSync(join(import.meta.dirname, f));
    }
  });
  guideCache.set(cacheKey, { files, at: Date.now() });
  return files;
}
const guideText = async (repo, file, ref = "") => {
  if (isForgeRepo(repo)) {
    const data = await forgeApi(`repos/${repo}/contents/${file}${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`);
    if (data.encoding !== "base64" || typeof data.content !== "string") throw new Error("Invalid git server guide content");
    return Buffer.from(data.content, "base64").toString("utf8");
  }
  if (ref) {
    try {
      return gh("api", `repos/${repo}/contents/${file}?ref=${encodeURIComponent(ref)}`, "-H", "Accept: application/vnd.github.raw");
    } catch {}
  }
  try {
    return gh("api", `repos/${repo}/contents/${file}`, "-H", "Accept: application/vnd.github.raw");
  } catch {
    return repo === REPO && existsSync(join(import.meta.dirname, file)) ? readFileSync(join(import.meta.dirname, file), "utf8") : "";
  }
};
async function guideFor(repo, ref = "", contentRepo = repo) {
  if (!REPO_RE.test(contentRepo)) throw new Error("Invalid guide repository");
  const files = await guideFiles(contentRepo, ref);
  if (!files.length) return null;
  const use = (await store.getSetting("guides"))?.[repo]?.use ?? true;
  if (!use) return null;
  const per = Math.floor(GUIDE_CHARS / files.length);
  return { file: files.join(" + "), text: (await Promise.all(files.map(async (f) => `--- ${f} ---\n${(await guideText(contentRepo, f, ref)).slice(0, per)}`))).join("\n\n") };
}

function normalizeLearningList(list) {
  return [
    ...new Set(
      (Array.isArray(list) ? list : [])
        .map((x) => String(typeof x === "object" && x !== null ? x.id || x.label || "" : x).trim())
        .filter(Boolean),
    ),
  ].slice(-50);
}

async function getRepoLearnings(repo) {
  if (!repo) return [];
  const [rs, guides] = await Promise.all([store.getSetting("repoSettings"), store.getSetting("guides")]);
  return normalizeLearningList(rs?.[repo]?.learnings ?? guides?.[repo]?.learnings ?? []);
}

async function setRepoLearnings(repo, list) {
  const normalized = normalizeLearningList(list);
  const [rs0, guides0] = await Promise.all([store.getSetting("repoSettings"), store.getSetting("guides")]);
  const repoSettings = { ...(rs0 || {}) };
  repoSettings[repo] = { ...(repoSettings[repo] || {}), learnings: normalized };
  const guides = { ...(guides0 || {}) };
  guides[repo] = { ...(guides[repo] || {}), learnings: normalized };
  await Promise.all([store.setSetting("repoSettings", repoSettings), store.setSetting("guides", guides)]);
  return normalized;
}

// Fixes this repository's authors applied from CodeOtter suggestions ("[file] title"), most recent last, capped at 30.
async function getRepoAccepted(repo) {
  return repo ? normalizeLearningList((await store.getSetting("repoSettings"))?.[repo]?.accepted ?? []) : [];
}
async function addRepoAccepted(repo, items) {
  const rs = { ...((await store.getSetting("repoSettings")) || {}) };
  const accepted = normalizeLearningList([...(rs[repo]?.accepted || []), ...items]).slice(-30);
  rs[repo] = { ...(rs[repo] || {}), accepted };
  await store.setSetting("repoSettings", rs);
  return accepted;
}

function extractHeadSha(pr, gitHistory = null) {
  return String(
    pr?.headRefOid ||
    pr?.headSha ||
    pr?.commits?.at(-1)?.oid ||
    gitHistory?.prCommits?.at(-1)?.sha ||
    "",
  ).trim();
}

function shaMatch(a, b) {
  const sa = String(a || "").trim().toLowerCase();
  const sb = String(b || "").trim().toLowerCase();
  if (!sa || !sb || sa.length < 7 || sb.length < 7) return false;
  return sa.startsWith(sb) || sb.startsWith(sa);
}

async function fetchGitHistory(repo, pr) {
  const prCommits = Array.isArray(pr.commits)
    ? pr.commits.map((c) => ({
        sha: String(c.oid || "").slice(0, 7),
        fullSha: String(c.oid || ""),
        message: String(c.messageHeadline || c.messageBody || "").trim(),
        body: String(c.messageBody || "").trim(),
        author: c.authors?.[0]?.login || c.authors?.[0]?.name || pr.author?.login || "",
        date: c.committedDate || "",
      }))
    : [];
  let baseCommits = [];
  try {
    const list = isForgeRepo(repo)
      ? await forgeApi(`repos/${repo}/commits?sha=${encodeURIComponent(pr.baseRefName)}&limit=8`)
      : JSON.parse(await ghAsync("api", `repos/${repo}/commits?sha=${encodeURIComponent(pr.baseRefName)}&per_page=8`));
    if (Array.isArray(list)) {
      baseCommits = list.map((c) => ({
        sha: String(c.sha || "").slice(0, 7),
        message: String(c.commit?.message || "").split("\n")[0].trim(),
        author: c.author?.login || c.commit?.author?.name || "",
      }));
    }
  } catch {}
  const formatted = [
    prCommits.length
      ? `PR Commits (${prCommits.length}):\n` + prCommits.map((c) => `- ${c.sha} ${c.message}${c.body ? ` (${c.body.slice(0, 160).replace(/\s+/g, " ")})` : ""}`).join("\n")
      : "",
    baseCommits.length
      ? `Recent ${pr.baseRefName} branch history:\n` + baseCommits.map((c) => `- ${c.sha} ${c.message}`).join("\n")
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  return { prCommits, baseCommits, formatted };
}

const ISSUE_REF_RE = /(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs?|#)\s*(?:([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+))?#(\d+)/gi;
const STANDALONE_ISSUE_RE = /(?:^|[^\w/])(?:([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+))?#(\d+)\b/g;
const BRANCH_ISSUE_RE = /(?:^|[/_-])(?:issue|fix|bug|feat|closes|resolves|gh)[/_-]?(\d+)\b|^(\d+)[/_-]/gi;

function parseLinkedIssueRefs(baseRepo, pr) {
  if (!baseRepo || !REPO_RE.test(baseRepo)) return [];
  const seen = new Set();
  const out = [];
  const addRef = (repoCandidate, numStr) => {
    const num = Number(numStr);
    if (!Number.isInteger(num) || num <= 0) return;
    let issueRepo = repoCandidate ? String(repoCandidate).trim() : baseRepo;
    if (isForgeRepo(baseRepo) && !isForgeRepo(issueRepo)) issueRepo = `${forgeId(baseRepo)}~${issueRepo}`;
    const [ownerPart, namePart] = issueRepo.split("/");
    if (!REPO_RE.test(issueRepo) || !OWNER_RE.test(ownerPart || "") || !OWNER_RE.test(namePart || "")) return;
    if (issueRepo === baseRepo && num === Number(pr?.number)) return;
    const key = `${issueRepo}#${num}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ repo: issueRepo, number: num });
  };

  const textSources = [String(pr?.title || ""), String(pr?.body || "")];
  for (const src of textSources) {
    for (const m of src.matchAll(ISSUE_REF_RE)) addRef(m[1], m[2]);
    for (const m of src.matchAll(STANDALONE_ISSUE_RE)) addRef(m[1], m[2]);
  }
  const branch = String(pr?.headRefName || "");
  if (branch) {
    for (const m of branch.matchAll(BRANCH_ISSUE_RE)) addRef(baseRepo, m[1] || m[2]);
  }
  return out.slice(0, 3);
}

async function fetchLinkedIssues(baseRepo, pr) {
  const refs = parseLinkedIssueRefs(baseRepo, pr);
  if (!refs.length) return [];
  const list = await Promise.all(
    refs.slice(0, 3).map(async ({ repo: issueRepo, number: num }) => {
      if (!REPO_RE.test(issueRepo)) return null;
      try {
        const raw = isForgeRepo(issueRepo) ? JSON.stringify(await forgeApi(`repos/${issueRepo}/issues/${num}`)) : await ghAsync(["issue", "view", String(num), "-R", issueRepo, "--json", "number,title,body,state,url,labels"]).catch(() =>
          gh(["issue", "view", String(num), "-R", issueRepo, "--json", "number,title,body,state,url,labels"]),
        );
        const iss = JSON.parse(raw);
        if (!iss || !iss.number) return null;
        return {
          number: Number(iss.number) || num,
          repo: issueRepo,
          title: String(iss.title || "").trim().slice(0, 300),
          body: String(iss.body || "").trim().slice(0, 1200),
          state: String(iss.state || "OPEN").toUpperCase(),
          url: isForgeRepo(issueRepo) ? `${forgeUrl(issueRepo)}/${nativeRepo(issueRepo)}/issues/${num}` : String(iss.url || `https://github.com/${issueRepo}/issues/${num}`),
          labels: Array.isArray(iss.labels)
            ? iss.labels.map((l) => (typeof l === "string" ? l : String(l?.name || ""))).filter(Boolean).slice(0, 12)
            : [],
        };
      } catch {
        return null;
      }
    }),
  );
  return list.filter(Boolean);
}

// Score rubrics (5 levels, index 0..4, mapped to 0..100) and merge gates (yes/no). `risk` gates pass when the answer is no.
const S1_SCORES = {
  quality: ["Broken or wrong", "Works but sloppy", "Acceptable", "Clean and idiomatic", "Exemplary"],
  correctness_risk: ["No realistic way to break anything", "Low risk", "Moderate risk of regressions", "High risk of regressions", "Very likely to break production"],
  test_coverage: ["No tests for the change", "Minimal tests", "Partial coverage", "Good coverage", "Thorough coverage"],
  readability: ["Hard to follow", "Below average", "Readable", "Clear", "Very clear"],
  pr_hygiene: ["Unclear title and description, mixed concerns", "Weak description or scope", "Adequate", "Well described and focused", "Exemplary title, description and scope"],
  blast_radius: ["Isolated change with no downstream effect", "Small local impact", "Moderate impact on nearby modules", "Wide impact across several areas", "System-wide or critical-path impact (auth, payments, migrations, deploy)"],
};
const S1_GATES = [
  { id: "title", label: "Title check", q: "The pull request title accurately describes the change.", risk: false },
  { id: "description", label: "Description check", q: "The pull request description explains what changed and why.", risk: false },
  { id: "security", label: "Security", q: "The change introduces a security risk (injection, auth bypass, secrets, unsafe deserialisation, SSRF, XSS).", risk: true },
  { id: "complexity", label: "Complexity", q: "The change is more complex than the problem requires.", risk: true },
  { id: "tests", label: "Tests", q: "The change is adequately covered by tests for its risk.", risk: false },
  { id: "docs", label: "Documentation", q: "Documentation is updated wherever behaviour visible to users or developers changed.", risk: false },
  { id: "scope", label: "Scope", q: "The pull request does one focused thing.", risk: false },
  { id: "guidelines", label: "Repository guidelines", q: "The change violates the repository's review guidelines.", risk: true, needsGuide: true },
  { id: "issue_requirements", label: "Issue requirements", q: "Does the pull request diff fulfill the requirements and acceptance criteria described in the linked issue(s)?", risk: false, needsIssues: true },
];
function s1State(pr, diff, c, guide = null, gitHistory = null, linkedIssues = [], learnings = [], incrementalCtx = null, outsideImpact = null, accepted = []) {
  if (c.local) return { pull_request: changeDigest(pr, diff, c.contextChars || 12000) };
  return {
    pull_request: {
      title: pr.title,
      description: (pr.body || "").slice(0, 3000),
      author: pr.author.login,
      base: pr.baseRefName,
      head: pr.headRefName,
      head_sha: pr.headSha || extractHeadSha(pr, gitHistory),
      commits: (gitHistory?.prCommits || []).slice(0, 30).map((cm) => `${cm.sha} ${cm.message}`),
      files: pr.files.map((f) => `${f.path} +${f.additions} -${f.deletions}`).slice(0, 200),
    },
    change_facts: (({ files, lines, dirs, hotspots, testFiles, outsideCallers, outsideFiles }) => ({ files, lines, areas: dirs, sensitive_areas: hotspots, test_files: testFiles, outside_callers: outsideCallers || 0, outside_files: outsideFiles || 0 }))(blastRadius(pr.files, outsideImpact?.outsideCallers || 0, outsideImpact?.uniqueFiles || 0)),
    ...(outsideImpact?.callers?.length
      ? {
          outside_diff_call_graph: {
            affected_outside_callers: outsideImpact.outsideCallers,
            unique_outside_files: outsideImpact.uniqueFiles,
            sampled_call_sites: outsideImpact.callers.slice(0, 6).map((c) => `${c.file}:${c.line} (${c.symbol})`),
          },
        }
      : {}),
    ...(incrementalCtx?.summaryText ? { incremental_review_delta: incrementalCtx.summaryText } : {}),
    ...(linkedIssues?.length
      ? {
          linked_issues: linkedIssues.map((iss) => ({
            number: iss.number,
            repo: iss.repo,
            title: iss.title,
            state: iss.state,
            labels: iss.labels || [],
            requirements: (iss.body || "").slice(0, 1200),
          })),
        }
      : {}),
    ...(guide ? { review_guidelines: guide.text.slice(0, c.contextChars ? Math.floor(c.contextChars / 4) : 12000) } : {}),
    ...(learnings?.length
      ? {
          repository_team_learnings: `Repository Team Learnings (Never flag these dismissed patterns):\n${learnings.map((l, i) => `${i + 1}. ${l}`).join("\n")}`,
        }
      : {}),
    ...(accepted?.length ? { fixes_this_team_accepted_before: accepted.slice(-10) } : {}),
    ...(gitHistory?.formatted ? { git_change_history: gitHistory.formatted.slice(0, 4000) } : {}),
    diff: compressDiff(diff, c.contextChars || 80000).diff,
  };
}
// What a small-context System One model reads instead of the head of the raw diff: the whole change in outline (every file
// with its line counts, tests, areas), then the largest hunks until the budget runs out. The model makes every call.
function changeDigest(pr, diff, maxChars) {
  const facts = blastRadius(pr.files || []);
  const files = [...(pr.files || [])].sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions));
  // gh lists at most 100 files; the pull request's own totals are exact
  const total = Math.max(files.length, Number(pr.changedFiles) || 0);
  const add = Number(pr.additions) || files.reduce((n, f) => n + f.additions, 0);
  const del = Number(pr.deletions) || files.reduce((n, f) => n + f.deletions, 0);
  let out = [
    `Title: ${pr.title}`,
    `Description: ${String(pr.body || "").replace(/\s+/g, " ").trim().slice(0, 400) || "(none)"}`,
    `Change: ${total} files, +${add} -${del} lines, ${facts.testFiles} test files, ${facts.dirs} areas${facts.hotspots.length ? `, touches ${facts.hotspots.join(", ")}` : ""}.`,
    "Files:",
  ].join("\n");
  const fileEnd = out.length + Math.floor(maxChars * 0.35);
  let shown = 0;
  for (const f of files) {
    const line = `\n${f.path} +${f.additions} -${f.deletions}`;
    if (out.length + line.length > fileEnd) break;
    out += line;
    shown++;
  }
  if (shown < total) out += `\n(${total - shown} more files)`;
  out += "\nLargest hunks:";
  for (const h of splitHunks(diff, 60, 1200)) {
    const block = `\n--- ${h.file} ${h.header}\n${h.diff.trimEnd()}`;
    if (out.length + block.length > maxChars) { out += block.slice(0, Math.max(0, maxChars - out.length)); break; }
    out += block;
  }
  return out.slice(0, maxChars);
}

// Fast triage: System One answers two questions about the whole change (correctness risk, blast radius) and the result is
// published at once as a commit status (codeotter/triage) and an updatable PR comment, so a pipeline can stop or continue
// within minutes. The deep review (language model / CodeReviewer) stays on demand. Fails loudly: status "error".
const TRIAGE_CONTEXT = "codeotter/triage";
const SHA_RE = /^[0-9a-f]{7,40}$/i;
const triageConfig = async () => ({ auto: false, stopAt: 75, ...((await store.getSetting("triage")) || {}) });
const triageRuns = new Map();
async function postTriageStatus(repo, sha, state, description, url) {
  if (!SHA_RE.test(sha || "")) return;
  const fields = { state, context: TRIAGE_CONTEXT, description: description.slice(0, 140), target_url: `${APP_URL}/review?pr=${encodeURIComponent(url)}` };
  if (isForgeRepo(repo)) return forgeApi(`repos/${repo}/statuses/${sha}`, { method: "POST", body: fields });
  return ghAsync(["api", "--method", "POST", `repos/${repo}/statuses/${sha}`, ...Object.entries(fields).flatMap(([k, v]) => ["-f", `${k}=${v}`])]);
}
function formatTriageComment(t) {
  const level = S1_SCORES.correctness_risk[Math.min(4, Math.round(t.risk / 25))];
  return [
    "<!-- codeotter:triage -->",
    "### 🦦 CodeOtter triage",
    "",
    `**${t.verdict === "attention" ? "⚠️ Needs attention" : "✅ OK to continue"}**: correctness risk **${t.risk}/100** (${level}), blast radius ${t.blast}/100. Stops at risk ${t.stopAt}.`,
    "",
    `System One \`${t.model}\` · ${t.seconds}s · commit \`${t.headSha.slice(0, 7)}\` · [Full review](${APP_URL}/review?pr=${encodeURIComponent(t.url)})`,
  ].join("\n");
}
async function saveTriage(entry) {
  const all = (await store.getSetting("triageResults")) || {};
  all[entry.url] = entry;
  const keep = Object.values(all).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 500);
  await store.setSetting("triageResults", Object.fromEntries(keep.map((x) => [x.url, x])));
  return entry;
}
async function triagePr(ref, repoHint = "") {
  const { urlGuess, spec } = await resolvePr(ref, repoHint);
  if (triageRuns.has(urlGuess)) return triageRuns.get(urlGuess);
  const run = (async () => {
    const started = Date.now();
    const pr = JSON.parse(await readPr(urlGuess, spec));
    const repo = repoOf(pr);
    const sha = SHA_RE.test(pr.headRefOid || "") ? pr.headRefOid : "";
    const base = { url: pr.url, repo, number: pr.number, title: pr.title, headSha: sha };
    try {
      const [cfg, s1] = await Promise.all([triageConfig(), s1Config()]);
      if (!s1.enabled) throw new Error(s1.provider === "none" ? "No System One model configured: open Admin / Model provider" : `${s1.local?.label || s1.provider} is not ready: open Admin / Local models`);
      await postTriageStatus(repo, sha, "pending", `System One triage running (${s1.provider})`, pr.url);
      const diff = await readPr(urlGuess, spec, true);
      const state = { pull_request: changeDigest(pr, diff, s1.contextChars || 12000) };
      const questions = Object.fromEntries(["correctness_risk", "blast_radius"].map((k) => [`score_${k}`, { type: "score", instructions: `Rate the pull request's ${k.replace("_", " ")}.`, criteria: S1_SCORES[k] }]));
      let a;
      try {
        a = await askSystemOne(state, questions, s1);
      } catch (err) {
        throw new Error(`System One model ${s1.provider}/${s1.model} failed: ${err.message}`);
      }
      const pct = (k) => {
        const v = Number(a?.[`score_${k}`]?.score);
        if (!Number.isFinite(v)) throw new Error(`System One model ${s1.provider}/${s1.model} did not answer ${k}`);
        return Math.max(0, Math.min(100, Math.round((v / 4) * 100)));
      };
      const risk = pct("correctness_risk");
      const entry = { ...base, risk, blast: pct("blast_radius"), verdict: risk >= cfg.stopAt ? "attention" : "ok", stopAt: cfg.stopAt, model: `${s1.provider}/${s1.model}`, seconds: Math.round((Date.now() - started) / 1000), at: new Date().toISOString() };
      await postTriageStatus(repo, sha, entry.verdict === "attention" ? "failure" : "success", `Risk ${risk}/100: ${entry.verdict === "attention" ? "needs attention" : "ok to continue"} (${entry.seconds}s)`, pr.url);
      const repoCfg = ((await store.getSetting("guides")) || {})[repo] || {};
      if (repoCfg.postScores ?? (await reviewConfig()).postScores) await syncPrComments({ pr }, repo, { triage: entry });
      return saveTriage(entry);
    } catch (e) {
      await postTriageStatus(repo, sha, "error", `Triage failed: ${e.message}`, pr.url).catch(() => {});
      await saveTriage({ ...base, error: e.message, at: new Date().toISOString() });
      throw e;
    }
  })().finally(() => triageRuns.delete(urlGuess));
  triageRuns.set(urlGuess, run);
  return run;
}

async function scoreWithSystemOne(pr, diff, c, guide, onPartial, gitHistory, linkedIssues = [], learnings = [], incrementalCtx = null, outsideImpact = null, accepted = []) {
  const state = s1State(pr, diff, c, guide, gitHistory, linkedIssues, learnings, incrementalCtx, outsideImpact, accepted);
  const questions = {};
  for (const [k, levels] of Object.entries(S1_SCORES)) questions[`score_${k}`] = { type: "score", instructions: `Rate the pull request's ${k.replace("_", " ")}.`, criteria: levels };
  for (const g of S1_GATES) if ((!g.needsGuide || (guide && !c.local)) && (!g.needsIssues || (linkedIssues?.length && !c.local))) questions[`gate_${g.id}`] = { type: "noul", instructions: g.q };
  let a;
  try {
    a = await askSystemOne(state, questions, c, onPartial ? (partial) => {
      const readyScores = {};
      for (const k of Object.keys(S1_SCORES)) {
        if (partial[`score_${k}`] !== undefined) readyScores[k] = Math.max(0, Math.min(100, Math.round((Number(partial[`score_${k}`]?.score) || 0) / 4 * 100)));
      }
      const gates = S1_GATES.filter((g) => partial[`gate_${g.id}`] !== undefined).map((g) => {
        const yes = Number(partial[`gate_${g.id}`].noul) || 0;
        return { id: g.id, label: g.label, yes: Math.round(yes * 100) / 100, pass: g.risk ? yes < 0.5 : yes >= 0.5 };
      });
      onPartial({ readyScores, gates, done: false });
    } : undefined);
  } catch (err) {
    throw new Error(`System One model ${c.provider}/${c.model} failed: ${err.message}`);
  }
  const missing = Object.keys(questions).filter((k) => !Number.isFinite(Number(a?.[k]?.[questions[k].type === "score" ? "score" : "noul"] ?? NaN)));
  if (missing.length) throw new Error(`System One model ${c.provider}/${c.model} did not answer: ${missing.join(", ")}`);
  const scores = Object.fromEntries(Object.keys(S1_SCORES).map((k) => [k, Math.max(0, Math.min(100, Math.round((Number(a[`score_${k}`]?.score) || 0) / 4 * 100)))]));
  const gates = S1_GATES.filter((g) => a[`gate_${g.id}`]).map((g) => { const yes = Number(a[`gate_${g.id}`].noul) || 0; return { id: g.id, label: g.label, yes: Math.round(yes * 100) / 100, pass: g.risk ? yes < 0.5 : yes >= 0.5 }; });
  onPartial?.({ readyScores: scores, gates, done: true });
  return { scores, gates };
}

// <dynamic-context>
// Git gives every hunk 3 fixed context lines on each side. A reviewer needs the enclosing declaration above a change and
// little below it, so code hunks are extended upward to the nearest declaration (at most `before` lines, read from the
// head file) and trailing context is cut to `after` lines. Lines already shown by the previous hunk are never repeated.
const DECL_RES = [
  /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\b\s*\*?\s*([\w$]*)\s*\(/,
  /^\s*(?:export\s+)?(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*(?::[^=]+)?=>|[\w$]+\s*=>)/,
  /^\s*(?:(?:export|default|public|private|protected|internal|static|abstract|final|sealed|partial|open|data|pub(?:\([^)]*\))?)\s+)*(?:class|interface|trait|struct|enum|impl|module|namespace|object|type)\s+([\w$:]+)/,
  /^\s*(?:(?:pub(?:\([^)]*\))?|async|unsafe|const|extern|private|public|internal|override|suspend|static|inline)\s+)*(?:fn|func|fun|def)\s+(?:\([^)]*\)\s*)?([\w$!?.]+)/,
  /^\s*(?:(?:public|private|protected|internal|static|async|override|virtual|abstract|final|readonly|get|set)\s+)*(?:[\w$<>[\],.?*&]+\s+)?([\w$]+)\s*\([^;]*\)\s*(?:[:-]>?\s*[^;{]+|throws\s+[\w., ]+)?\s*\{\s*$/,
];
const NOT_DECL = new Set(["if", "for", "while", "switch", "catch", "with", "return", "else", "do", "try", "new", "throw", "await", "elif", "unless", "until"]);
const NON_CODE_RE = /\.(md|markdown|txt|rst|json|lock|svg|png|jpe?g|gif|ico|pdf|csv|tsv|ya?ml|toml|ini|map|snap)$|\.min\.(js|css)$/i;
function declName(line) {
  for (const re of DECL_RES) {
    const m = String(line ?? "").match(re);
    if (m && !NOT_DECL.has(m[1])) return m[1] || "function";
  }
  return null;
}
// Unified diff -> [{ file, parts: [line | { old, oldN, new, newN, heading, lines }] }], CRLF normalised.
function parseDiff(diff) {
  const files = [];
  let f = null;
  let h = null;
  for (const line of String(diff || "").replace(/\r\n?/g, "\n").split("\n")) {
    if (line.startsWith("diff --git ")) { h = null; f = { file: (line.match(/ b\/(.+)$/) || [])[1] || "", parts: [line] }; files.push(f); continue; }
    if (!f) { f = { file: "", parts: [] }; files.push(f); }
    const m = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/);
    if (m) { h = { old: +m[1], oldN: +(m[2] ?? 1), new: +m[3], newN: +(m[4] ?? 1), heading: m[5], lines: [] }; f.parts.push(h); continue; }
    if (h && /^[ +\-\\]/.test(line)) { h.lines.push(line); continue; }
    h = null;
    if (line.startsWith("+++ ") && !line.endsWith("/dev/null")) f.file = line.slice(4).replace(/^b\//, "").trim();
    f.parts.push(line);
  }
  return files;
}
const leadHasDecl = (h) => {
  const first = h.lines.findIndex((l) => l[0] === "+" || l[0] === "-");
  return h.lines.slice(0, first < 0 ? h.lines.length : first).some((l) => declName(l.slice(1)));
};
// Files whose hunks would gain from upward extension: code, not new, and no declaration in the leading context.
const dynamicContextFiles = (parsed) => [...new Set(parsed
  .filter((f) => f.file && !NON_CODE_RE.test(f.file) && f.parts.some((p) => typeof p === "object" && p.new > 1 && p.oldN > 0 && !leadHasDecl(p)))
  .map((f) => f.file))];
// `sources` maps path -> head file text. Returns the rewritten diff and counts.
function extendDiffContext(diff, sources = new Map(), { before = 16, after = 1 } = {}) {
  const parsed = parseDiff(diff);
  const stats = { extended: 0, added: 0, trimmed: 0 };
  const out = [];
  for (const f of parsed) {
    const code = f.file && !NON_CODE_RE.test(f.file);
    const text = code && typeof sources.get(f.file) === "string" ? sources.get(f.file).replace(/\r\n?/g, "\n").split("\n") : null;
    let lastShown = 0;
    for (const p of f.parts) {
      if (typeof p === "string") { out.push(p); continue; }
      let { lines, old, oldN, new: start, newN } = p;
      if (code && lines.some((l) => l[0] === "+" || l[0] === "-")) {
        let tail = 0;
        while (tail < lines.length && lines[lines.length - 1 - tail][0] === " ") tail++;
        if (tail > after) {
          const cut = tail - after;
          lines = lines.slice(0, lines.length - cut);
          oldN -= cut; newN -= cut; stats.trimmed += cut;
        }
        // Only extend when the hunk's first context line matches the fetched file, so a stale ref never invents lines.
        if (text && before > 0 && start > 1 && oldN > 0 && !leadHasDecl(p) && (lines[0]?.[0] !== " " || lines[0].slice(1) === text[start - 1])) {
          for (let j = start - 2; j >= Math.max(lastShown, start - 1 - before); j--) {
            if (!declName(text[j])) continue;
            const extra = text.slice(j, start - 1).map((l) => ` ${l}`);
            lines = [...extra, ...lines];
            old -= extra.length; oldN += extra.length; start -= extra.length; newN += extra.length;
            stats.extended++; stats.added += extra.length;
            break;
          }
        }
      }
      out.push(`@@ -${old},${oldN} +${start},${newN} @@${p.heading}`, ...lines);
      lastShown = start + newN - 1;
    }
  }
  return { diff: out.join("\n"), stats };
}
// </dynamic-context>

// <diff-compression>
// A diff over budget is not cut at a character count. Files are ranked (main language first, then other code, then
// docs and config, then lockfiles and generated output), largest first within a rank, and added whole until the budget
// runs out; a file too big to fit shows its leading hunks, and files that do not fit at all are still named. Only when over budget, hunks that only delete lines are dropped and
// deleted files are listed by name.
const GENERATED_RE = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|go\.sum|poetry\.lock|composer\.lock|Gemfile\.lock)$|\.(lock|min\.js|min\.css|map|snap)$|(^|\/)(dist|build|vendor|node_modules)\//i;
const extOf = (p) => (p.match(/\.([\w]+)$/) || [])[1]?.toLowerCase() || "";
function compressDiff(diff, maxChars) {
  diff = String(diff || "");
  if (diff.length <= maxChars) return { diff, compressed: false, omitted: [], deleted: [], deletionHunks: 0 };
  const files = parseDiff(diff).filter((f) => f.parts.length);
  let deletionHunks = 0;
  const deleted = [];
  const entries = [];
  for (const f of files) {
    const name = f.file || (f.parts.find((p) => typeof p === "string" && p.startsWith("--- a/")) || "").slice(6);
    const hunks = f.parts.filter((p) => typeof p === "object");
    if (f.parts.some((p) => typeof p === "string" && (p.startsWith("deleted file mode") || p === "+++ /dev/null"))) { deleted.push(name); continue; }
    const kept = hunks.filter((h) => h.lines.some((l) => l[0] === "+"));
    deletionHunks += hunks.length - kept.length;
    const head = f.parts.filter((p) => typeof p === "string");
    if (hunks.length && !kept.length) { deleted.push(`${name} (lines removed only)`); continue; }
    const blocks = kept.map((h) => [`@@ -${h.old},${h.oldN} +${h.new},${h.newN} @@${h.heading}`, ...h.lines].join("\n").trimEnd());
    const text = [...head, ...blocks].join("\n").trimEnd();
    const added = kept.reduce((n, h) => n + h.lines.filter((l) => l[0] === "+").length, 0);
    entries.push({ name, head: head.join("\n"), blocks, text, added, removed: kept.reduce((n, h) => n + h.lines.filter((l) => l[0] === "-").length, 0) });
  }
  const weight = new Map();
  for (const e of entries) if (!NON_CODE_RE.test(e.name) && !GENERATED_RE.test(e.name)) weight.set(extOf(e.name), (weight.get(extOf(e.name)) || 0) + e.added);
  const main = [...weight].sort((a, b) => b[1] - a[1])[0]?.[0];
  const rank = (e) => GENERATED_RE.test(e.name) ? 3 : NON_CODE_RE.test(e.name) ? 2 : extOf(e.name) === main ? 0 : 1;
  entries.sort((a, b) => rank(a) - rank(b) || b.text.length - a.text.length);
  // Room for the trailing file lists, bounded so they never crowd out the code.
  const listRoom = Math.min(Math.floor(maxChars * 0.15), 120 + 60 * (entries.length + deleted.length));
  const budget = maxChars - listRoom;
  const shown = [];
  const omitted = [];
  let used = 0;
  const partial = [];
  for (const e of entries) {
    if (used + e.text.length + 1 <= budget) { shown.push(e.text); used += e.text.length + 1; continue; }
    // Too big to fit whole: its leading hunks, up to half the budget, so one file cannot take all of it.
    const room = Math.min(budget - used, Math.floor(budget / 2)) - e.head.length - 80;
    let part = "";
    let n = 0;
    while (n < e.blocks.length && part.length + e.blocks[n].length + 1 <= room) part += `\n${e.blocks[n++]}`;
    if (!n) { omitted.push(e); continue; }
    const text = `${e.head}${part}\n(${e.blocks.length - n} more hunk(s) in ${e.name} not shown)`;
    shown.push(text); used += text.length + 1; partial.push(e.name);
  }
  // A single hunk larger than the whole budget still shows its start rather than nothing.
  if (!shown.length && omitted.length) { const e = omitted.shift(); shown.push(`${e.text.slice(0, budget)}\n(${e.name} cut at the diff budget)`); }
  let tail = "";
  if (deleted.length) tail += `\n\nDeleted files:\n${deleted.join("\n")}`;
  if (omitted.length) tail += `\n\nAlso changed, not shown (over the diff budget):\n${omitted.map((e) => `${e.name} +${e.added} -${e.removed}`).join("\n")}`;
  if (deletionHunks) tail += `\n\n${deletionHunks} hunk(s) that only remove lines are not shown.`;
  const out = `${shown.join("\n")}${tail.length > listRoom ? `${tail.slice(0, listRoom - 20)}\n(list cut)` : tail}`;
  return { diff: out.slice(0, maxChars), compressed: true, omitted: omitted.map((e) => e.name), partial, deleted, deletionHunks };
}
// </diff-compression>

// <accepted>
// A suggestion counts as accepted when its code (compared line by line, ignoring indentation and blank lines) is in the
// file at the new head and was not at the previously reviewed commit. Both file versions are required.
const codeKey = (s) => String(s || "").replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
function acceptedSuggestions(findings, before, after) {
  return (findings || [])
    .filter((f) => f?.file && !f.dismissed && codeKey(f.suggestion).length >= 12)
    .filter((f) => {
      const a = after.get(f.file);
      const b = before.get(f.file);
      return typeof a === "string" && typeof b === "string" && codeKey(a).includes(codeKey(f.suggestion)) && !codeKey(b).includes(codeKey(f.suggestion));
    })
    .map((f) => `[${f.file}] ${String(f.title || "").trim()}`.slice(0, 300));
}
// </accepted>

// Head-revision text of changed files, for dynamic context. Capped in count and size; a file that fails is skipped.
async function headFileTexts(pr, paths, max = 25, maxChars = 400000, ref = pr.headRefOid || pr.headRefName) {
  const repo = pr.headRepo || repoOf(pr);
  const texts = new Map();
  if (!ref || !REPO_RE.test(repo)) return texts;
  const enc = (p) => p.split("/").map(encodeURIComponent).join("/");
  await Promise.all(paths.slice(0, max).map(async (p) => {
    if (p.split("/").some((s) => !s || s === "." || s === "..")) return;
    try {
      let text;
      if (isForgeRepo(repo)) {
        const data = await forgeApi(`repos/${repo}/contents/${enc(p)}?ref=${encodeURIComponent(ref)}`);
        if (data?.encoding !== "base64" || typeof data.content !== "string") return;
        text = Buffer.from(data.content, "base64").toString("utf8");
      } else {
        text = await ghAsync("api", `repos/${repoOf(pr)}/contents/${enc(p)}?ref=${encodeURIComponent(ref)}`, "-H", "Accept: application/vnd.github.raw");
      }
      if (text.length <= maxChars) texts.set(p, text);
    } catch {}
  }));
  return texts;
}

// Unified diff -> [{ file, header, diff }] hunks, largest first, capped. CodeReviewer reads one hunk at a time (512 tokens).
function splitHunks(diff, maxHunks = 40, maxChars = 2000) {
  const out = [];
  let file = "";
  let cur = null;
  const push = () => { if (cur && cur.diff.trim()) out.push(cur); cur = null; };
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git")) { push(); file = (line.match(/ b\/(.+)$/) || [])[1] || file; continue; }
    if (line.startsWith("+++ ")) { const target = line.slice(4).replace(/^b\//, ""); if (target !== "/dev/null") file = target || file; continue; }
    if (line.startsWith("--- ") || line.startsWith("index ") || line.startsWith("new file") || line.startsWith("deleted file") || line.startsWith("similarity") || line.startsWith("rename ")) continue;
    if (line.startsWith("@@")) { push(); cur = { file, header: line, diff: "" }; continue; }
    if (cur && cur.diff.length < maxChars) cur.diff += line + "\n";
  }
  push();
  return out.filter((h) => !/\.(lock|min\.js|map|snap)$/.test(h.file)).sort((a, b) => b.diff.length - a.diff.length).slice(0, maxHunks);
}
async function reviewWithCodeReviewer(pr, diff, c, guide, gitHistory, onProgress = null, linkedIssues = [], learnings = [], incrementalCtx = null) {
  const activeDiff = incrementalCtx?.deltaDiff || diff;
  const hunks = splitHunks(activeDiff);
  const files = [...new Set(hunks.map((h) => h.file))];
  const commitNote = incrementalCtx?.newCommits?.length
    ? ` Incremental delta ${incrementalCtx.prevSha.slice(0, 7)} -> ${incrementalCtx.headSha.slice(0, 7)} (${incrementalCtx.newCommits.length} new commit(s)).`
    : gitHistory?.prCommits?.length
      ? ` Analyzed ${gitHistory.prCommits.length} commit(s) (${gitHistory.prCommits.slice(0, 3).map((x) => x.sha).join(", ")})`
      : "";
  const guideNote = guide?.file ? ` against ${guide.file} guidelines` : "";
  const issueNote = linkedIssues?.length ? ` Validated against linked issue(s) ${linkedIssues.map((i) => `#${i.number}`).join(", ")}.` : "";
  const learningNote = learnings?.length ? ` Enforced ${learnings.length} repository team learning(s).` : "";
  const port = await ensureSidecar(c.local);
  const seen = new Set();
  const findings = [];
  const rawLog = [];
  const batchSize = 4;
  for (let start = 0; start < hunks.length; start += batchSize) {
    const batch = hunks.slice(start, start + batchSize);
    const res = await fetch(`http://127.0.0.1:${port}/v1/review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hunks: batch.map((h) => ({ file: h.file, diff: h.diff })) }),
      signal: AbortSignal.timeout(900000),
    });
    if (!res.ok) throw new Error(`Review engine ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const { comments } = await res.json();
    for (let bi = 0; bi < batch.length; bi++) {
      const h = batch[bi];
      const cm = (comments || []).find((x) => x.index === bi);
      const text = String(cm?.comment || "").trim();
      rawLog.push(`[Hunk ${start + bi + 1}/${hunks.length}] ${h.file} ${h.header}\n${text ? `-> ${text}` : "-> ✓ Clean hunk (no issues flagged)"}`);
      if (!text || text.length < 12 || seen.has(text.toLowerCase())) continue;
      seen.add(text.toLowerCase());
      const first = text.split(/(?<=[.!?])\s/)[0];
      const titleCandidate = first.length > 90 ? first.slice(0, 87) + "…" : first;
      const isDismissedByRule = (learnings || []).some((rule) => {
        const norm = String(rule).toLowerCase();
        return norm.includes(titleCandidate.toLowerCase().slice(0, 40)) || (h.file && norm.includes(`[${h.file.toLowerCase()}]`) && norm.includes(first.toLowerCase().slice(0, 24)));
      });
      if (isDismissedByRule) continue;
      findings.push(
        deriveSuggestionFromDetail(
          {
            file: h.file,
            severity: /bug|wrong|incorrect|leak|crash|null|undefined|security|inject|unsafe|race|deadlock|error/i.test(text) ? "medium" : "low",
            title: titleCandidate,
            detail: `${text}\n\n${h.header}\n${h.diff.trim()}`,
          },
          activeDiff,
        ),
      );
    }
    const doneHunks = Math.min(hunks.length, start + batch.length);
    onProgress?.({
      summary: `CodeOtter inspected ${doneHunks} of ${hunks.length} diff hunks across ${files.length} changed files${guideNote}.${commitNote}${issueNote}${learningNote} Found ${findings.length} actionable observation(s) so far.`,
      findings: findings.slice(0, 20),
      walkthrough: files.map((f) => ({ file: f, change: `${hunks.filter((h) => h.file === f).length} hunk(s) reviewed` })),
      rawOutput: rawLog.join("\n\n"),
    });
  }
  return {
    summary: `CodeOtter reviewed ${hunks.length} diff hunks across ${files.length} changed files${guideNote}.${commitNote}${issueNote}${learningNote} Found ${findings.length} actionable observation(s).`,
    verdict: findings.some((f) => f.severity === "medium") ? "comment" : findings.length ? "comment" : "approve",
    scores: { quality: 0, correctness_risk: 0, test_coverage: 0, readability: 0, pr_hygiene: 0 },
    findings: findings.slice(0, 20),
    walkthrough: files.map((f) => ({ file: f, change: `${hunks.filter((h) => h.file === f).length} hunk(s) reviewed` })),
    rawOutput: rawLog.join("\n\n"),
  };
}

// CodeReviewer writes a comment for every hunk, including questions and style remarks. System One reads each comment with
// its hunk and keeps only those that name a concrete problem in the change. Fails the review if System One fails.
const S1_FINDING_MIN = 0.7; // accuracy over coverage: keep a comment only when System One is clearly confident
const S1_FINDING_CHECK = "The review comment points to a concrete problem in this code change (a bug, broken or missing behaviour, a security issue, or a missing test for changed logic). Answer no for questions, guesses, style or naming preferences, and comments the code change does not support.";
async function verifyFindingsWithSystemOne(findings, s1, onProgress = null) {
  const kept = [];
  for (const [i, f] of findings.entries()) {
    const [comment, ...hunk] = String(f.detail || "").split("\n\n");
    const room = Math.max(400, (s1.contextChars || 4000) - comment.length - f.file.length - 400);
    const state = { file: f.file, review_comment: comment, code_change: hunk.join("\n\n").slice(0, room) };
    let a;
    try {
      a = await askSystemOne(state, { finding_valid: { type: "noul", instructions: S1_FINDING_CHECK } }, s1);
    } catch (err) {
      throw new Error(`System One model ${s1.provider}/${s1.model} failed while checking review comments: ${err.message}`);
    }
    const yes = Number(a?.finding_valid?.noul);
    if (!Number.isFinite(yes)) throw new Error(`System One model ${s1.provider}/${s1.model} did not answer the review comment check`);
    if (yes >= S1_FINDING_MIN) kept.push({ ...f, confidence: Math.round(yes * 100) / 100 });
    onProgress?.(i + 1, findings.length, kept.length);
  }
  return kept.sort((x, y) => y.confidence - x.confidence);
}

function findFileLineInDiff(file, diff) {
  if (!file || !diff) return 0;
  const lines = String(diff).split("\n");
  let inFile = false;
  let curLine = 0;
  for (const l of lines) {
    if (l.startsWith("diff --git")) {
      inFile = l.endsWith(` b/${file}`) || l.includes(` b/${file} `);
      curLine = 0;
      continue;
    }
    if (l.startsWith("+++ ")) {
      const target = l.slice(4).replace(/^b\//, "").trim();
      inFile = target === file;
      continue;
    }
    if (!inFile) continue;
    const hm = l.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hm) {
      curLine = parseInt(hm[1], 10);
      continue;
    }
    if (curLine > 0) {
      if (l.startsWith("+") && !l.startsWith("+++")) return curLine;
      if (l.startsWith("-") && !l.startsWith("---")) return curLine;
      if (l.startsWith(" ")) curLine++;
    }
  }
  return 0;
}

function deriveSuggestionFromDetail(f, diff = "") {
  const str = (x, max) => String(x ?? "").slice(0, max);
  const SEV_MAP = {
    blocker: "high",
    major: "medium",
    minor: "low",
    high: "high",
    medium: "medium",
    low: "low",
    nit: "nit",
  };
  const rawSev = String(f?.severity || "low").toLowerCase();
  const severity = SEV_MAP[rawSev] || "low";
  const file = str(f?.file, 300).trim();
  const title = str(f?.title, 300).trim();
  let detail = str(f?.detail, 4000);

  // 1. Determine target line in new file
  let line = Number.isFinite(Number(f?.line)) && Number(f.line) > 0 ? Math.round(Number(f.line)) : 0;
  if (!line && detail) {
    const hunkMatch = detail.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@([^\n]*)\n([\s\S]*)/);
    if (hunkMatch) {
      let curLine = parseInt(hunkMatch[1], 10);
      let foundLine = 0;
      for (const hl of hunkMatch[3].split("\n")) {
        if (hl.startsWith("+++") || hl.startsWith("---")) continue;
        if (hl.startsWith("+") || hl.startsWith("-")) {
          foundLine = curLine;
          break;
        }
        if (hl.startsWith(" ")) curLine++;
      }
      line = foundLine || parseInt(hunkMatch[1], 10);
    } else {
      const hmSimple = detail.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (hmSimple) line = parseInt(hmSimple[1], 10);
    }
  }
  if (!line && detail) {
    const lineRef = detail.match(/(?:\bline\s+|[:#]L|\bL)(\d{1,6})\b/i);
    if (lineRef) line = parseInt(lineRef[1], 10);
  }
  if (!line && file && diff) {
    line = findFileLineInDiff(file, diff);
  }

  // 2. Determine replacement suggestion snippet (without markdown backticks)
  let suggestion = "";
  if (typeof f?.suggestion === "string" && f.suggestion.trim()) {
    suggestion = f.suggestion
      .trim()
      .replace(/^```(?:suggestion|[a-zA-Z0-9_-]*)\r?\n?/i, "")
      .replace(/\r?\n?```$/i, "")
      .replace(/\r?\n$/, "");
  }
  if (!suggestion && detail) {
    const sugFence = detail.match(/```suggestion\r?\n([\s\S]*?)```/i);
    if (sugFence) {
      suggestion = sugFence[1].replace(/\r?\n$/, "");
      detail = detail.replace(sugFence[0], "").trim();
    } else {
      const explanationPart = detail.split("\n\n@@")[0] || detail;
      const codeFence = explanationPart.match(/```(?:[a-zA-Z0-9_-]*)\r?\n([\s\S]*?)```/);
      if (codeFence && codeFence[1].trim()) {
        const inner = codeFence[1].replace(/\r?\n$/, "");
        if (!inner.startsWith("@@")) {
          const plusLines = inner
            .split("\n")
            .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
            .map((l) => l.slice(1));
          suggestion = plusLines.length ? plusLines.join("\n") : inner;
        }
      } else {
        const inlineReplace = explanationPart.match(/(?:replace\s+with|change\s+to|use\s+instead|suggested\s+fix|fix)\s*[:：]?\s*`([^`\n]{3,240})`/i);
        if (inlineReplace) {
          suggestion = inlineReplace[1].trim();
        }
      }
    }
  }

  const startLine = Math.round(Number(f?.startLine));
  return {
    file,
    ...(line > 0 ? { line } : {}),
    // A suggestion that replaces lines startLine..line (multi-line); absent means it replaces `line` only.
    ...(line > 0 && startLine > 0 && startLine < line && line - startLine < 200 ? { startLine } : {}),
    severity,
    title,
    detail,
    ...(suggestion ? { suggestion: str(suggestion, 2000) } : {}),
    ...(f?.dismissed ? { dismissed: true } : {}),
    ...(Number.isFinite(Number(f?.confidence)) && f?.confidence !== null && f?.confidence !== "" ? { confidence: Math.max(0, Math.min(1, Number(f.confidence))) } : {}),
  };
}

function prompt(pr, diff, c, r = REVIEW_DEFAULTS, guide = null, wantScores = true, gitHistory = null, linkedIssues = [], learnings = [], incrementalCtx = null, outsideImpact = null, accepted = []) {
  const outsideBlock = outsideImpact?.formatted ? `\n${outsideImpact.formatted}\n` : "";
  const issueBlock = linkedIssues?.length
    ? `\nLinked Issues & Requirements (MANDATORY: explicitly verify whether the pull request diff fulfills all requirements and acceptance criteria described in these linked issues, and flag any unfulfilled or partially met requirement in findings):\n${linkedIssues
        .map((iss) => `Issue #${iss.number} (${iss.repo}, ${iss.state}): ${iss.title}${iss.labels?.length ? ` [${iss.labels.join(", ")}]` : ""}\n${(iss.body || "(no body provided)").slice(0, 1200)}`)
        .join("\n\n")}\n`
    : "";
  const learningsBlock = learnings?.length
    ? `\nRepository Team Learnings (Never flag these dismissed patterns):\n${learnings.map((l) => `- ${l}`).join("\n")}\n`
    : "";
  const incrementalBlock = incrementalCtx?.promptBlock ? `\n${incrementalCtx.promptBlock}\n` : "";
  const acceptedBlock = accepted?.length
    ? `\nFixes this team accepted from earlier reviews (look for the same kinds of problems):\n${accepted.slice(-10).map((a) => `- ${a}`).join("\n")}\n`
    : "";
  return `You are CodeOtter, a strict senior staff code reviewer. Review this pull request using the repository's review guidelines (AGENTS.md / CLAUDE.md), the repository team learnings, the linked issues and acceptance criteria, the git commit history, the outside-diff call graph context, and the code diff. Reply with ONLY a JSON object:
{"summary":"3-5 sentence architectural walkthrough covering what changed, commit progression, fulfillment of linked issue requirements, adherence to repository guidelines, and outside caller safety","verdict":"approve|comment|request_changes",
${wantScores ? ` "scores":{"quality":0-100,"correctness_risk":0-100 (100 = very risky),"test_coverage":0-100,"readability":0-100,"pr_hygiene":0-100 (title, description, scope, commit focus),"blast_radius":0-100 (100 = system-wide or critical-path impact)},\n` : ""} "findings":[{"severity":"blocker|major|minor|nit|high|medium|low","file":"path","line":42,"title":"short","detail":"specific line/behaviour and fix (cite AGENTS.md/CLAUDE.md rule, linked issue #number requirement, or commit if relevant)","suggestion":"optional exact replacement code"}],
 "walkthrough":[{"file":"path","change":"concise summary of change in this file"}]}
For each finding, include the integer target \`line\` number in the new file and an optional \`suggestion\` containing the exact replacement code snippet for the target line/block (without markdown backticks) so the fix can be applied in one click. Be concrete; cite exact files and rules. Respect all Repository Team Learnings and never flag dismissed patterns. Max ${r.maxFindings} findings, most severe first. Today is ${new Date().toISOString().slice(0, 10)}.

PR #${pr.number}: ${pr.title}
Author: ${pr.author.login}  Base: ${pr.baseRefName} <- Head: ${pr.headRefName}${pr.headSha ? ` (${pr.headSha.slice(0, 7)})` : ""}  Files: ${pr.changedFiles}  +${pr.additions} -${pr.deletions}
Description:
${(pr.body || "(none)").slice(0, c.contextChars ? Math.min(3000, Math.floor(c.contextChars / 10)) : 3000)}
${outsideBlock}${incrementalBlock}${issueBlock}${learningsBlock}${acceptedBlock}${gitHistory?.formatted ? `\nGit Change History (commits in this PR and recent target branch history):\n${gitHistory.formatted.slice(0, 4000)}\n` : ""}${guide ? `\nRepository Review Guidelines from ${guide.file} (MANDATORY: verify all code changes and commits against these rules and flag any violation in findings):\n${guide.text}\n` : ""}
Diff${diff.length > Math.min(r.diffChars, c.contextChars || Infinity) ? " (over budget: highest-priority files first, the rest named at the end)" : ""}:
${compressDiff(diff, Math.min(r.diffChars, c.contextChars || Infinity)).diff}`;
}

// <reflect>
// Self-reflection: a second pass of the same model scores each finding 0-10 against the diff, as a skeptical reviewer.
// Findings below the configured minimum are dropped; the rest are ordered by that score. A failed pass fails the review.
async function reflectFindings(pr, diff, c, r, findings) {
  const list = findings.map((f, i) => `${i}. [${f.severity}] ${f.file}${f.line ? `:${f.line}` : ""}: ${f.title}\n${String(f.detail || "").slice(0, 800)}${f.suggestion ? `\nSuggested code:\n${f.suggestion.slice(0, 600)}` : ""}`).join("\n\n");
  const text = await askModel(`You are checking another reviewer's findings on pull request #${pr.number} (${pr.title}). For each finding, score 0-10 how sure you are that it names a real, concrete problem that this diff introduces or leaves broken and that the author should fix: 0 = wrong, not supported by the diff, or a question or style preference; 5 = plausible but unproven; 10 = certain defect. A suggested fix that is wrong lowers the score. Reply with ONLY a JSON object: {"scores":[{"index":0,"score":0-10,"why":"one sentence"}]}

Findings:
${list}

Diff:
${compressDiff(diff, Math.min(r.diffChars, c.contextChars || Infinity)).diff}`, { ...c, temperature: 0 });
  let out;
  try {
    out = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  } catch {
    throw new Error(`${c.provider}/${c.model} did not return valid JSON when checking its findings`);
  }
  const scores = new Map((Array.isArray(out.scores) ? out.scores : []).map((x) => [Number(x?.index), Number(x?.score)]).filter(([i, v]) => Number.isInteger(i) && Number.isFinite(v)));
  if (findings.some((_, i) => !scores.has(i))) throw new Error(`${c.provider}/${c.model} did not score every finding when checking them`);
  return findings
    .map((f, i) => ({ ...f, confidence: Math.max(0, Math.min(10, Math.round(scores.get(i)))) / 10 }))
    .filter((f) => f.confidence * 10 >= r.reflectMin)
    .sort((a, b) => b.confidence - a.confidence);
}
// </reflect>

async function judge(pr, diff, c, r = REVIEW_DEFAULTS, guide = null, wantScores = true, gitHistory = null, onProgress = null, linkedIssues = [], learnings = [], incrementalCtx = null, outsideImpact = null, accepted = []) {
  if (c.api === "codereviewer") return reviewWithCodeReviewer(pr, diff, c, guide, gitHistory, onProgress, linkedIssues, learnings, incrementalCtx);
  const text = await askModel(prompt(pr, diff, c, r, guide, wantScores, gitHistory, linkedIssues, learnings, incrementalCtx, outsideImpact, accepted), { ...c, temperature: r.temperature });
  let out;
  try {
    out = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  } catch {
    throw new Error("The model did not return valid JSON; try again or pick another model");
  }
  const n = (x) => Math.max(0, Math.min(100, Math.round(Number(x)) || 0));
  const str = (x, max) => String(x ?? "").slice(0, max);
  const scoreKeys = ["quality", "correctness_risk", "test_coverage", "readability", "pr_hygiene", "blast_radius"];
  if (wantScores) {
    const missing = scoreKeys.filter((k) => out.scores?.[k] === null || out.scores?.[k] === "" || !Number.isFinite(Number(out.scores?.[k])));
    if (missing.length) throw new Error(`${c.provider}/${c.model} returned no usable scores for: ${missing.join(", ")}`);
  }
  let findings = (Array.isArray(out.findings) ? out.findings : []).slice(0, 20).map((f) => deriveSuggestionFromDetail(f, diff));
  let reflected = "";
  if (r.reflectMin > 0 && findings.length) {
    onProgress?.({ summary: `Checking ${findings.length} finding(s) against the diff…` });
    const before = findings.length;
    findings = await reflectFindings(pr, diff, c, r, findings);
    reflected = ` Self-check kept ${findings.length} of ${before} finding(s).`;
  }
  return {
    summary: str(out.summary, 2500 - reflected.length) + reflected,
    verdict: ["approve", "comment", "request_changes"].includes(out.verdict) ? out.verdict : "comment",
    scores: Object.fromEntries(scoreKeys.slice(0, 5).map((k) => [k, n(out.scores?.[k])])),
    ...(wantScores ? { blastRadius: n(out.scores.blast_radius) } : {}),
    findings,
    walkthrough: (Array.isArray(out.walkthrough) ? out.walkthrough : []).slice(0, 100).filter((w) => w && typeof w.file === "string").map((w) => ({ file: str(w.file, 300), change: str(w.change, 500) })),
    rawOutput: str(text, 20000),
  };
}

function base64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function createGitHubAppJwt(appId, pem) {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(
    JSON.stringify({
      iat: now - 60,
      exp: now + 600,
      iss: String(appId),
    }),
  );
  const sign = createSign("RSA-SHA256");
  sign.update(`${header}.${payload}`);
  sign.end();
  const signature = base64url(sign.sign(pem));
  return `${header}.${payload}.${signature}`;
}

async function getGitHubAppRepos(appConfig) {
  if (!appConfig?.id || !appConfig?.pem) return [];
  try {
    const jwt = createGitHubAppJwt(appConfig.id, appConfig.pem);
    const instRes = await fetch("https://api.github.com/app/installations?per_page=100", {
      headers: {
        authorization: `Bearer ${jwt}`,
        accept: "application/vnd.github+json",
        "user-agent": "CodeOtter",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!instRes.ok) return [];
    const installations = await instRes.json();
    if (!Array.isArray(installations)) return [];

    const repoNames = [];
    for (const inst of installations) {
      const tokenRes = await fetch(`https://api.github.com/app/installations/${inst.id}/access_tokens`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${jwt}`,
          accept: "application/vnd.github+json",
          "user-agent": "CodeOtter",
        },
        signal: AbortSignal.timeout(10000),
      });
      if (!tokenRes.ok) continue;
      const tokenData = await tokenRes.json();
      const instToken = tokenData.token;
      if (!instToken) continue;

      let page = 1;
      while (page <= 10) {
        const reposRes = await fetch(`https://api.github.com/installation/repositories?per_page=100&page=${page}`, {
          headers: {
            authorization: `Bearer ${instToken}`,
            accept: "application/vnd.github+json",
            "user-agent": "CodeOtter",
          },
          signal: AbortSignal.timeout(10000),
        });
        if (!reposRes.ok) break;
        const reposData = await reposRes.json();
        const batch = Array.isArray(reposData.repositories) ? reposData.repositories : [];
        if (!batch.length) break;
        for (const r of batch) {
          if (r.full_name) repoNames.push(r.full_name);
        }
        if (batch.length < 100) break;
        page++;
      }
    }
    return repoNames;
  } catch {
    return [];
  }
}

// Onboarded repositories. Saved from the Repositories settings page; falls back to REPO (env or the repo launched from).
const repos = async () => {
  const saved = await store.getSetting("repos");
  return Array.isArray(saved) ? saved : REPO ? [REPO] : [];
};
let ghReposCache;
async function repositoryChoices(owner = "") {
  if (owner && !OWNER_RE.test(owner)) return [];
  if (isForgeRepo(owner)) return (await forgeList("user/repos", forgeId(owner))).map((r) => `${forgeId(owner)}~${r.full_name}`).filter((r) => REPO_RE.test(r) && r.startsWith(`${owner}/`));

  let savedGhToken = (await store.getSetting("githubToken")) || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
  if (!savedGhToken) {
    try {
      savedGhToken = execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
    } catch {}
  }
  if (savedGhToken) {
    process.env.GITHUB_TOKEN = savedGhToken;
    process.env.GH_TOKEN = savedGhToken;
  }

  const githubApp = await store.getSetting("githubApp");
  const githubOwner = (await store.getSetting("githubOwner")) || "";

  ghReposCache ||= new Map();
  if (!ghReposCache.has(owner)) {
    const listSet = new Set();

    // 1. Try GitHub App installation repositories (public & private)
    if (githubApp?.id && githubApp?.pem) {
      try {
        const appRepos = await getGitHubAppRepos(githubApp);
        for (const r of appRepos) {
          if (!owner || r.startsWith(`${owner}/`)) listSet.add(r);
        }
      } catch {}
    }

    // 2. Try User Personal Access Token / env token (public & private across all user affiliations)
    if (savedGhToken) {
      try {
        let page = 1;
        while (page <= 10) {
          const ghUrl = `https://api.github.com/user/repos?per_page=100&page=${page}&visibility=all&affiliation=owner,collaborator,organization_member&sort=updated`;
          const res = await fetch(ghUrl, {
            headers: {
              authorization: `Bearer ${savedGhToken}`,
              accept: "application/vnd.github+json",
              "user-agent": "CodeOtter",
            },
            signal: AbortSignal.timeout(10000),
          });
          if (!res.ok) break;
          const items = await res.json();
          if (!Array.isArray(items) || !items.length) break;
          for (const r of items) {
            if (r.full_name && (!owner || r.full_name.startsWith(`${owner}/`))) {
              listSet.add(r.full_name);
            }
          }
          if (items.length < 100) break;
          page++;
        }
      } catch {}

      // Query user's organizations
      try {
        const orgsRes = await fetch("https://api.github.com/user/orgs?per_page=100", {
          headers: {
            authorization: `Bearer ${savedGhToken}`,
            accept: "application/vnd.github+json",
            "user-agent": "CodeOtter",
          },
          signal: AbortSignal.timeout(8000),
        });
        if (orgsRes.ok) {
          const orgs = await orgsRes.json();
          if (Array.isArray(orgs)) {
            for (const org of orgs) {
              if (org.login) {
                let page = 1;
                while (page <= 5) {
                  const res = await fetch(`https://api.github.com/orgs/${encodeURIComponent(org.login)}/repos?per_page=100&page=${page}&type=all&sort=updated`, {
                    headers: {
                      authorization: `Bearer ${savedGhToken}`,
                      accept: "application/vnd.github+json",
                      "user-agent": "CodeOtter",
                    },
                    signal: AbortSignal.timeout(8000),
                  });
                  if (!res.ok) break;
                  const items = await res.json();
                  if (!Array.isArray(items) || !items.length) break;
                  for (const r of items) {
                    if (r.full_name && (!owner || r.full_name.startsWith(`${owner}/`))) {
                      listSet.add(r.full_name);
                    }
                  }
                  if (items.length < 100) break;
                  page++;
                }
              }
            }
          }
        }
      } catch {}
    }

    // 3. Try GitHub Owner public/org endpoints
    const ownersToTry = new Set([
      owner,
      githubOwner,
      githubApp?.owner,
      REPO ? REPO.split("/")[0] : "",
      "dharmeshgurnani",
    ].filter(Boolean));

    if (PB_URL) {
      try {
        const users = await store.users();
        for (const u of users) {
          if (u.username && OWNER_RE.test(u.username)) ownersToTry.add(u.username);
          const namePart = u.name?.trim().split(/\s+/)[0];
          if (namePart && OWNER_RE.test(namePart)) ownersToTry.add(namePart);
        }
      } catch {}
    }
    for (const o of ownersToTry) {
      for (const ep of ["users", "orgs"]) {
        try {
          const res = await fetch(`https://api.github.com/${ep}/${o}/repos?per_page=100&sort=updated`, {
            headers: {
              ...(savedGhToken ? { authorization: `Bearer ${savedGhToken}` } : {}),
              accept: "application/vnd.github+json",
              "user-agent": "CodeOtter",
            },
            signal: AbortSignal.timeout(6000),
          });
          if (res.ok) {
            const items = await res.json();
            if (Array.isArray(items)) {
              for (const r of items) {
                if (r.full_name && (!owner || r.full_name.startsWith(`${owner}/`))) {
                  listSet.add(r.full_name);
                }
              }
            }
          }
        } catch {}
      }
    }

    // 4. Try gh CLI
    if (!listSet.size) {
      try {
        const ghItems = JSON.parse(gh("repo", "list", ...(owner ? [owner] : []), "--limit", "100", "--json", "nameWithOwner"));
        if (Array.isArray(ghItems)) {
          for (const r of ghItems) {
            if (r.nameWithOwner) listSet.add(r.nameWithOwner);
          }
        }
      } catch {}
    }

    ghReposCache.set(owner, [...listSet]);
  }
  const github = ghReposCache.get(owner) || [];
  const allChoices = new Set(github);
  if (REPO && (!owner || REPO.startsWith(`${owner}/`))) allChoices.add(REPO);
  const currentSaved = await store.getSetting("repos");
  if (Array.isArray(currentSaved)) {
    for (const r of currentSaved) if (!owner || r.startsWith(`${owner}/`)) allChoices.add(r);
  }

  if (!owner) {
    const remote = await Promise.all(Object.entries(FORGES).filter(([, f]) => f.url && f.token).map(async ([id]) =>
      (await forgeList("user/repos", id)).map((r) => `${id}~${r.full_name}`).filter((r) => REPO_RE.test(r))));
    for (const r of remote.flat()) allChoices.add(r);
  }
  return [...allChoices];
}

const activeReviews = new Map();

async function resolvePr(ref, repo) {
  ref = decodeURIComponent(String(ref || "")).trim();
  if (!/^[1-9]\d*$/.test(ref) && !validPrUrl(ref)) throw new Error("Paste a GitHub or configured Forgejo or Gitea pull request URL, or a number with a repository selected");
  if (repo && !REPO_RE.test(repo)) throw new Error(`Not an owner/name: ${repo}`);
  if (/^\d+$/.test(ref) && !repo) repo = (await repos())[0];
  if (/^\d+$/.test(ref) && !repo) throw new Error("Paste the full pull request URL, or add a repository first");
  const urlGuess = /^\d+$/.test(ref) ? prUrlFor(repo, ref) : ref;
  if (!validPrUrl(urlGuess) || (repo && parsePrUrl(urlGuess).repo !== repo)) throw new Error("PR and repository mismatch");
  const spec = /^\d+$/.test(ref) ? ["-R", repo, ref] : [ref];
  return { urlGuess, spec };
}

const hasValidScores = (s) => s && typeof s === "object" && ["quality", "correctness_risk", "test_coverage", "readability", "pr_hygiene"].some((k) => Number(s[k]) > 0);

async function startOrPollReview(ref, force, repo, part = "") {
  const { urlGuess, spec } = await resolvePr(ref, repo);
  const existing = activeReviews.get(urlGuess);
  if (!force && existing) {
    if (existing.error) {
      activeReviews.delete(urlGuess);
      throw new Error(existing.error);
    }
    return existing.state;
  }
  const stored = (await store.get(urlGuess)) || (await store.reviews()).find((x) => x.pr?.url === urlGuess) || null;
  // Merge any in-flight state with stored state so partial re-runs never lose live scores or narrative
  const cached = existing?.state
    ? {
        ...stored,
        ...existing.state,
        blast: existing.state.blast?.score ? existing.state.blast : (stored?.blast || existing.state.blast),
        gates: existing.state.gates?.length ? existing.state.gates : (stored?.gates || []),
        review: {
          ...(stored?.review || {}),
          ...(existing.state.review || {}),
          scores: hasValidScores(existing.state.review?.scores)
            ? existing.state.review.scores
            : (stored?.review?.scores || existing.state.review?.scores),
        },
      }
    : stored;

  // If not forced, return cached only if its scores are valid (auto-heal records whose scores were zeroed)
  if (!force && cached && hasValidScores(cached.review?.scores)) {
    const repoLearnings = await getRepoLearnings(repoOf(cached.pr));
    const headSha = extractHeadSha(cached.pr, cached.gitHistory) || cached.headSha;
    const normFindings = Array.isArray(cached.review?.findings)
      ? cached.review.findings.map((f) => deriveSuggestionFromDetail(f, ""))
      : [];
    return {
      ...cached,
      ...(headSha ? { headSha, pr: { ...cached.pr, headSha } } : {}),
      learnings: repoLearnings,
      review: { ...cached.review, findings: normFindings },
    };
  }
  if (!force && cached && !hasValidScores(cached.review?.scores)) {
    part = cached.review?.summary ? "scores" : "";
  }

  const [c, s1, rc] = await Promise.all([llmConfig(), s1Config(), reviewConfig()]);
  const llmReady = c.local ? c.enabled : !!c.model && (!!c.apiKey || !!PROVIDERS[c.provider]?.noKey || /localhost|127\.0\.0\.1/.test(c.baseUrl));
  if (!llmReady && !s1.enabled) throw new Error("No model configured: open Settings / Model provider");
  if (llmReady && c.api === "codereviewer" && !s1.enabled) throw new Error(`${c.local.label} writes review comments only. Configure a System One model for scores (Settings / Model provider; Laya runs on CPU next to it).`);

  const runScores = !part || part === "scores" || !cached || !hasValidScores(cached.review?.scores);
  const runLlm = !part || part === "llm" || !cached || !cached.review?.summary;

  // Use cached PR metadata immediately on Re-review if available, or fetch non-blockingly via ghAsync
  const pr = cached?.pr || JSON.parse(await readPr(urlGuess, spec));
  const initialHeadSha = extractHeadSha(pr, cached?.gitHistory) || cached?.headSha || "";
  if (initialHeadSha) pr.headSha = initialHeadSha;
  const initialLearnings = await getRepoLearnings(repoOf(pr));
  const prevBlast = cached?.blast;
  const blast = !runScores && prevBlast ? { ...prevBlast } : blastRadius(pr.files);
  const engines = { llm: llmReady ? `${c.provider}/${c.model}` : null, s1: s1.enabled ? `${s1.provider}/${s1.model}` : null };
  const modelLabel = [engines.llm, engines.s1].filter(Boolean).join(" + ");
  const prevReview = cached?.review || {};
  const initialScores = hasValidScores(prevReview.scores)
    ? { ...prevReview.scores }
    : { quality: 0, correctness_risk: 0, test_coverage: 0, readability: 0, pr_hygiene: 0 };
  const live = {
    pr,
    ...(initialHeadSha ? { headSha: initialHeadSha } : {}),
    ...(cached?.incremental ? { incremental: cached.incremental } : {}),
    blast: { ...blast },
    review: {
      summary: !runLlm ? (prevReview.summary || "") : "",
      verdict: !runLlm ? (prevReview.verdict || "comment") : "comment",
      scores: initialScores,
      findings: !runLlm ? (prevReview.findings || []) : [],
      walkthrough: !runLlm ? (prevReview.walkthrough || []) : [],
      rawOutput: !runLlm ? (prevReview.rawOutput || "") : "",
    },
    gates: !runScores && cached?.gates ? [...cached.gates] : [],
    engines,
    model: modelLabel,
    guide: cached?.guide || null,
    learnings: initialLearnings,
    linkedIssues: cached?.linkedIssues || [],
    gitHistory: cached?.gitHistory || { prCommits: Array.isArray(pr.commits) ? pr.commits.map((cm) => ({ sha: String(cm.oid || "").slice(0, 7), message: String(cm.messageHeadline || "").trim(), author: cm.authors?.[0]?.login || pr.author?.login || "" })) : [], baseCommits: [] },
    at: new Date().toISOString(),
    pending: {
      scores: runScores,
      readyScores: !runScores && hasValidScores(prevReview.scores) ? { ...prevReview.scores, blast_radius: blast.score } : {},
      gates: runScores && !!s1.enabled,
      narrative: runLlm && !!llmReady,
    },
  };
  const entry = { state: live, error: null, promise: null };
  activeReviews.set(pr.url, entry);

  entry.promise = (async () => {
    try {
      // Refresh PR metadata in background if we started from cached.pr
      if (cached?.pr) live.pr = JSON.parse(await readPr(urlGuess, spec));
      const [rawDiff, guide, learnings] = await Promise.all([
        readPr(urlGuess, spec, true),
        Promise.resolve().then(() => guideFor(repoOf(live.pr), isForgeRepo(repoOf(live.pr)) ? live.pr.headRefOid : live.pr.headRefName, live.pr.headRepo || repoOf(live.pr))),
        getRepoLearnings(repoOf(pr)),
      ]);
      live.guide = guide?.file || null;
      live.learnings = learnings;
      let diff = rawDiff;
      if (rc.contextLines > 0) {
        const parsed = parseDiff(rawDiff);
        const sources = await headFileTexts(live.pr, dynamicContextFiles(parsed));
        const ext = extendDiffContext(rawDiff, sources, { before: rc.contextLines, after: 1 });
        diff = ext.diff;
        live.dynamicContext = ext.stats;
      }

      const outsideImpact = await sliceOutsideDiffImpact(repoOf(live.pr), diff, (live.pr.files || []).map((f) => f.path));
      live.outsideDiffImpact = outsideImpact;
      const fb = blastRadius(live.pr.files, outsideImpact.outsideCallers, outsideImpact.uniqueFiles);
      const keepScore = !runScores || live.blast.source === "s1";
      live.blast = { ...fb, ...(keepScore ? { score: live.blast.score, source: live.blast.source || prevBlast?.source || "s1" } : {}) };
      const [gitHistory, linkedIssues] = await Promise.all([
        fetchGitHistory(repoOf(live.pr), live.pr),
        fetchLinkedIssues(repoOf(live.pr), live.pr),
      ]);
      const currentHeadSha = extractHeadSha(live.pr, gitHistory) || initialHeadSha;
      if (currentHeadSha) {
        live.pr.headSha = currentHeadSha;
        live.headSha = currentHeadSha;
      }
      live.gitHistory = {
        prCommits: gitHistory.prCommits.map(({ sha, message, author }) => ({ sha, message, ...(author ? { author } : {}) })),
        baseCommits: gitHistory.baseCommits,
      };
      live.linkedIssues = linkedIssues;

      // Incremental Commit-by-Commit Delta computation when a prior review exists
      const prevSaved = stored;
      const prevSha = String(
        prevSaved?.headSha ||
        prevSaved?.pr?.headSha ||
        prevSaved?.pr?.headRefOid ||
        prevSaved?.gitHistory?.prCommits?.at(-1)?.sha ||
        "",
      ).trim();
      const prevFindings = (prevSaved?.review?.findings || []).filter((f) => !f.dismissed);
      let incrementalCtx = null;
      if (prevSaved && (prevSha || prevFindings.length > 0)) {
        const prCommits = gitHistory.prCommits || [];
        const prevIdx = prevSha ? prCommits.findIndex((cm) => shaMatch(cm.sha, prevSha) || shaMatch(cm.fullSha, prevSha)) : -1;
        const hasNewSha = prevSha && currentHeadSha && !shaMatch(prevSha, currentHeadSha);
        const newCommits = hasNewSha
          ? (prevIdx >= 0 ? prCommits.slice(prevIdx + 1) : prCommits)
          : [];
        let deltaDiff = "";
        if (hasNewSha && newCommits.length > 0) {
          try {
            const cmpRaw = isForgeRepo(repoOf(live.pr)) ? JSON.stringify(await forgeApi(`repos/${repoOf(live.pr)}/compare/${encodeURIComponent(prevSha)}...${encodeURIComponent(currentHeadSha)}`)) : await ghAsync("api", `repos/${repoOf(live.pr)}/compare/${encodeURIComponent(prevSha)}...${encodeURIComponent(currentHeadSha)}`).catch(() =>
              gh(["api", `repos/${repoOf(live.pr)}/compare/${encodeURIComponent(prevSha)}...${encodeURIComponent(currentHeadSha)}`]),
            );
            const cmp = JSON.parse(cmpRaw);
            if (Array.isArray(cmp?.files)) {
              deltaDiff = cmp.files
                .filter((f) => f?.filename && f?.patch)
                .map((f) => `diff --git a/${f.filename} b/${f.filename}\n--- a/${f.filename}\n+++ b/${f.filename}\n${f.patch}`)
                .join("\n\n");
            }
          } catch {}
        }
        const shortPrev = (prevSha || currentHeadSha || "prev").slice(0, 7);
        const shortHead = (currentHeadSha || prevSha || "head").slice(0, 7);
        const promptParts = [
          `Incremental Review Delta: Reviewing new commits since ${shortPrev} -> ${shortHead} (${newCommits.length} new commit(s)).`,
          ...(newCommits.length
            ? [`New commits since ${shortPrev}:\n${newCommits.map((cm) => `- ${cm.sha} ${cm.message}`).join("\n")}`]
            : []),
          ...(prevFindings.length
            ? [
                `Prior review findings at commit ${shortPrev} (MANDATORY: verify whether each prior finding was fixed in the latest code/delta; do NOT re-report findings that have been resolved):\n` +
                  prevFindings.map((pf, idx) => `${idx + 1}. [${pf.severity}] ${pf.file}: ${pf.title}`).join("\n"),
              ]
            : []),
          ...(deltaDiff
            ? [`Incremental Commit Delta Diff (${shortPrev}...${shortHead}, focus on these changes first):\n${deltaDiff.slice(0, 24000)}`]
            : []),
        ];
        incrementalCtx = {
          prevSha: shortPrev,
          headSha: shortHead,
          newCommits: newCommits.map((cm) => ({ sha: cm.sha, message: cm.message, ...(cm.author ? { author: cm.author } : {}) })),
          prevFindings,
          deltaDiff,
          summaryText: `Incremental Review Delta: ${shortPrev} -> ${shortHead} (${newCommits.length} new commits, ${prevFindings.length} prior findings checked)`,
          promptBlock: promptParts.join("\n\n"),
        };
        live.incremental = {
          prevSha: incrementalCtx.prevSha,
          headSha: incrementalCtx.headSha,
          newCommits: incrementalCtx.newCommits,
          resolvedFindings: prevSaved?.incremental?.resolvedFindings || [],
        };
        // Learn from suggestions the author applied since the last review. A failed lookup only skips the learning.
        const withFix = prevFindings.filter((f) => f.suggestion && f.file);
        if (hasNewSha && withFix.length) {
          try {
            const paths = [...new Set(withFix.map((f) => f.file))];
            const [before, after] = await Promise.all([headFileTexts(live.pr, paths, 25, 400000, prevSha), headFileTexts(live.pr, paths)]);
            const accepted = acceptedSuggestions(withFix, before, after);
            if (accepted.length) {
              await addRepoAccepted(repoOf(live.pr), accepted);
              live.acceptedFixes = accepted;
            }
          } catch (e) {
            console.warn(`[accepted] ${e.message}`);
          }
        }
      }
      const acceptedFixes = await getRepoAccepted(repoOf(live.pr));

      const s1Task = runScores && s1.enabled
        ? scoreWithSystemOne(live.pr, diff, s1, guide, ({ readyScores, gates, done }) => {
            live.pending.readyScores = { ...live.pending.readyScores, ...readyScores };
            if (readyScores.blast_radius !== undefined) {
              live.blast = { ...live.blast, score: readyScores.blast_radius, source: "s1" };
            }
            const { blast_radius, ...restScores } = live.pending.readyScores;
            live.review = { ...live.review, scores: { ...live.review.scores, ...restScores } };
            if (gates?.length) live.gates = gates;
            if (done) {
              live.pending.scores = false;
              live.pending.gates = false;
            }
          }, gitHistory, linkedIssues, learnings, incrementalCtx, outsideImpact, acceptedFixes)
        : Promise.resolve(null);

      const needLlmForScores = runScores && !s1.enabled;
      const llmTask = (runLlm || needLlmForScores) && llmReady
        ? judge(live.pr, diff, c, rc, guide, !s1.enabled, gitHistory, (partial) => {
            if (runLlm) {
              live.review = { ...live.review, ...partial, scores: live.review.scores };
            }
          }, linkedIssues, learnings, incrementalCtx, outsideImpact, acceptedFixes).then(({ blastRadius: llmBlast, ...nav }) => {
            const scores = (!runScores || s1.enabled)
              ? (hasValidScores(live.review.scores) ? live.review.scores : initialScores)
              : nav.scores;
            if (runScores && !s1.enabled) live.blast = { ...live.blast, score: llmBlast, source: "llm" };
            const merged = { ...nav, scores };
            live.review = runLlm ? merged : { ...live.review, scores };
            live.pending.narrative = false;
            if (!s1.enabled && runScores) {
              live.pending.scores = false;
              live.pending.readyScores = { ...scores, blast_radius: live.blast.score };
            }
            return merged;
          })
        : Promise.resolve(null);

      const [narrative, typed] = await Promise.all([llmTask, s1Task]);
      let review = runLlm && narrative ? narrative : live.review;
      if (runLlm && c.api === "codereviewer" && s1.enabled && review?.findings?.length) {
        const proposed = review.findings;
        live.pending.narrative = true;
        live.review = { ...live.review, findings: [] };
        const kept = (await verifyFindingsWithSystemOne(proposed, s1, (done, total, k) => {
          live.review = { ...live.review, summary: `System One checked ${done} of ${total} CodeReviewer comments; kept ${k}.` };
        })).slice(0, rc.maxFindings || REVIEW_DEFAULTS.maxFindings);
        live.pending.narrative = false;
        review = {
          ...review,
          summary: `${review.summary.replace(/ Found \d+ actionable observation\(s\)\./, "")} System One kept ${kept.length} of ${proposed.length} CodeReviewer comments.`,
          verdict: kept.length ? "comment" : "approve",
          findings: kept,
        };
      }
      if (typed) {
        const { blast_radius, ...scores } = typed.scores;
        live.blast.score = blast_radius;
        live.blast.source = "s1";
        if (!review?.summary && !runLlm) {
          review = { ...live.review, scores };
        } else if (!review?.summary) {
          const g = typed.gates;
          const bad = g.some((x) => x.id === "security" && !x.pass) || scores.quality < 40;
          review = { summary: "Scored by CodeOtter.", verdict: bad ? "request_changes" : scores.quality >= 70 && g.every((x) => x.pass) ? "approve" : "comment", scores, findings: [], walkthrough: [] };
        } else review = { ...review, scores };
      } else if (!hasValidScores(review?.scores) && hasValidScores(initialScores)) {
        review = { ...review, scores: initialScores };
      }
      const finalGates = typed?.gates || (live.gates?.length ? live.gates : cached?.gates) || [];
      let finalIncremental = cached?.incremental;
      if (incrementalCtx) {
        const newFindingsList = review?.findings || [];
        const resolvedFindings = runLlm
          ? incrementalCtx.prevFindings.filter((pf) => {
              const pfFile = String(pf.file || "").toLowerCase();
              const pfTitle = String(pf.title || "").toLowerCase().slice(0, 32);
              const stillPresent = newFindingsList.some((nf) => {
                const nfFile = String(nf.file || "").toLowerCase();
                const nfTitle = String(nf.title || "").toLowerCase().slice(0, 32);
                return nfFile === pfFile && (nfTitle === pfTitle || (pfTitle.length >= 10 && nfTitle.includes(pfTitle.slice(0, 16))) || (nfTitle.length >= 10 && pfTitle.includes(nfTitle.slice(0, 16))));
              });
              return !stillPresent;
            })
          : (prevSaved?.incremental?.resolvedFindings || []);
        finalIncremental = {
          prevSha: incrementalCtx.prevSha,
          headSha: incrementalCtx.headSha,
          newCommits: incrementalCtx.newCommits,
          resolvedFindings,
        };
      }
      const result = {
        pr: live.pr,
        ...(currentHeadSha ? { headSha: currentHeadSha } : {}),
        ...(finalIncremental ? { incremental: finalIncremental } : {}),
        ...(live.acceptedFixes ? { acceptedFixes: live.acceptedFixes } : {}),
        blast: live.blast,
        outsideDiffImpact: live.outsideDiffImpact,
        review,
        gates: finalGates,
        engines,
        model: modelLabel,
        guide: guide?.file || null,
        learnings,
        linkedIssues: live.linkedIssues || [],
        gitHistory: live.gitHistory,
        at: new Date().toISOString(),
      };
      const repoCfg = ((await store.getSetting("guides")) || {})[repoOf(live.pr)] || {};
      const rsCfg = ((await store.getSetting("repoSettings")) || {})[repoOf(live.pr)] || {};
      const doPostScores = repoCfg.postScores ?? rc.postScores;
      const doPostReview = repoCfg.postReview ?? rc.postReview;
      const doPostInlineSuggestions = repoCfg.postInlineSuggestions ?? rsCfg.postInlineSuggestions ?? rc.postInlineSuggestions;
      await syncPrComments(result, repoOf(live.pr), {
        postScores: !!(runScores && doPostScores && (typed || review?.scores)),
        postReview: !!(runLlm && doPostReview && review?.summary),
        postInlineSuggestions: !!(runLlm && doPostInlineSuggestions && (review?.findings || []).some((f) => !f.dismissed && (f.suggestion || f.line))),
      });
      await store.put(result);
      entry.state = result;
      setTimeout(() => { if (activeReviews.get(live.pr.url) === entry) activeReviews.delete(live.pr.url); }, 30000).unref?.();
      return result;
    } catch (e) {
      entry.error = e.message;
      throw e;
    }
  })();
  // Async polling reads entry.error on the next request; keep background failures handled.
  entry.promise.catch(() => {});

  return live;
}

async function postInlineSuggestionsOnPr(r, repo = repoOf(r.pr), { findingIdx = null } = {}) {
  if (!r?.pr?.number || !repo || !REPO_RE.test(repo)) throw new Error("Invalid PR or repository");
  const allFindings = Array.isArray(r.review?.findings) ? r.review.findings : [];
  const candidates =
    findingIdx !== null && findingIdx !== undefined
      ? [allFindings[Number(findingIdx)]].filter(Boolean)
      : allFindings.filter((f) => !f?.dismissed && f?.file && (f?.suggestion || f?.line));
  if (!candidates.length) return { posted: 0, mode: "none", comments: [] };

  const rawHeadSha = String(
    r.pr?.headRefOid ||
      (r.headSha && r.headSha.length >= 40 ? r.headSha : "") ||
      (r.pr?.headSha && r.pr.headSha.length >= 40 ? r.pr.headSha : "") ||
      r.gitHistory?.prCommits?.at(-1)?.fullSha ||
      r.headSha ||
      r.pr?.headSha ||
      "",
  ).trim();

  const comments = candidates
    .map((rawF) => {
      const f = deriveSuggestionFromDetail(rawF, "");
      if (!f.file) return null;
      const targetLine = Number(f.line) > 0 ? Math.round(Number(f.line)) : 1;
      const explanation = String(f.detail || "").split("\n\n@@")[0].trim();
      const bodyLines = [
        `<!-- codeotter:suggestion:${f.file}:${targetLine} -->`,
        `🦦 **CodeOtter [${String(f.severity || "low").toUpperCase()}]** — **${f.title || "Suggested fix"}** (\`${f.file}:L${targetLine}\`)`,
        ...(explanation ? ["", explanation] : []),
        // Forgejo and Gitea review comments cover one line, so a multi-line fix is shown, not offered for commit.
        ...(f.suggestion
          ? [
              "",
              f.startLine && isForgeRepo(repo) ? `Replaces lines ${f.startLine}-${targetLine}:\n\`\`\`` : "```suggestion",
              String(f.suggestion).replace(/\r?\n$/, ""),
              "```",
            ]
          : []),
      ];
      return {
        path: f.file,
        line: targetLine,
        ...(f.startLine && f.startLine < targetLine ? { startLine: f.startLine } : {}),
        side: "RIGHT",
        body: bodyLines.join("\n"),
        finding: f,
      };
    })
    .filter(Boolean);

  if (!comments.length) return { posted: 0, mode: "none", comments: [] };

  if (isForgeRepo(repo)) {
    if (!validPrUrl(r.pr.url) || repoOf(r.pr) !== repo || Number(r.pr.url.split("/").at(-1)) !== Number(r.pr.number)) throw new Error("PR and repository mismatch");
    try {
      await forgeApi(`repos/${repo}/pulls/${r.pr.number}/reviews`, { method: "POST", body: {
        event: "COMMENT", body: "CodeOtter inline suggestions", ...(rawHeadSha ? { commit_id: rawHeadSha } : {}),
        comments: comments.map((c) => ({ path: c.path, new_position: c.line, old_position: 0, body: c.body })),
      } });
      return { posted: comments.length, mode: "inline_review", comments: comments.map((c) => ({ path: c.path, line: c.line })) };
    } catch (e) {
      // A line outside the diff may be rejected; auth/network failures must not trigger another write.
      if (![400, 422].includes(e.status)) throw e;
      await createPrComment(r.pr.url, repo, r.pr.number, comments.map((c) => c.body).join("\n\n"));
      return { posted: comments.length, mode: "pr_comment_fallback", comments: comments.map((c) => ({ path: c.path, line: c.line })) };
    }
  }

  const buildReviewArgs = (includeCommitId) => {
    const args = [
      "api",
      "--method",
      "POST",
      `repos/${repo}/pulls/${r.pr.number}/reviews`,
      "-f",
      "event=COMMENT",
      "-f",
      `body=🦦 **CodeOtter Inline Suggestion${comments.length === 1 ? "" : "s"}** (${comments.length} committable fix${comments.length === 1 ? "" : "es"})`,
    ];
    if (includeCommitId && rawHeadSha) {
      args.push("-f", `commit_id=${rawHeadSha}`);
    }
    for (const c of comments) {
      args.push(
        "-f",
        `comments[][path]=${c.path}`,
        "-F",
        `comments[][line]=${c.line}`,
        "-f",
        `comments[][side]=${c.side}`,
        ...(c.startLine ? ["-F", `comments[][start_line]=${c.startLine}`, "-f", `comments[][start_side]=${c.side}`] : []),
        "-f",
        `comments[][body]=${c.body}`,
      );
    }
    return args;
  };

  try {
    const args = buildReviewArgs(rawHeadSha.length >= 7);
    await ghAsync(args).catch(() => gh(args));
    return {
      posted: comments.length,
      mode: "inline_review",
      comments: comments.map((c) => ({ path: c.path, line: c.line })),
    };
  } catch {
    try {
      if (rawHeadSha) {
        const argsNoSha = buildReviewArgs(false);
        await ghAsync(argsNoSha).catch(() => gh(argsNoSha));
        return {
          posted: comments.length,
          mode: "inline_review",
          comments: comments.map((c) => ({ path: c.path, line: c.line })),
        };
      }
    } catch {}
    // Fallback to a line-referenced PR comment if the target line isn't part of the GitHub diff hunk
    const fallbackBody = [
      `<!-- codeotter:suggestion-comment -->`,
      `### 🦦 CodeOtter — Inline Suggestion${comments.length === 1 ? "" : "s"}`,
      ...comments.flatMap((c) => [
        "",
        `#### \`${c.path}:L${c.line}\` — **${c.finding.title || "Suggested fix"}** (\`${String(c.finding.severity || "low").toUpperCase()}\`)`,
        ...(c.finding.detail ? [String(c.finding.detail).split("\n\n@@")[0].trim()] : []),
        ...(c.finding.suggestion
          ? [
              "```suggestion",
              String(c.finding.suggestion).replace(/\r?\n$/, ""),
              "```",
            ]
          : []),
      ]),
    ].join("\n");
    await ghAsync("pr", "comment", r.pr.url, "--body", fallbackBody).catch(() =>
      gh(["pr", "comment", r.pr.url, "--body", fallbackBody]),
    );
    return {
      posted: comments.length,
      mode: "pr_comment_fallback",
      comments: comments.map((c) => ({ path: c.path, line: c.line })),
    };
  }
}

async function syncPrComments(r, repo = repoOf(r.pr), { postScores = false, postReview = false, postInlineSuggestions = false, triage = null, extra = [] } = {}) {
  if (!postScores && !postReview && !postInlineSuggestions && !triage && !extra.length) return [];
  const commentAuthor = isForgeRepo(repo) ? await forgeApi("user", { source: forgeId(repo) }) : null;
  let existingComments = [];
  try {
    // Forgejo's issue-comment endpoint returns all comments and ignores page/limit.
    const raw = isForgeRepo(repo) ? JSON.stringify(await forgeApi(`repos/${repo}/issues/${r.pr.number}/comments`)) : await ghAsync(["api", `repos/${repo}/issues/${r.pr.number}/comments?per_page=100`]).catch(() =>
      gh(["api", `repos/${repo}/issues/${r.pr.number}/comments`]),
    );
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) existingComments = parsed;
  } catch (e) { if (isForgeRepo(repo)) throw e; }

  const upsert = async (marker, body, label) => {
    const existing = existingComments.find((c) => typeof c?.body === "string" && c.body.includes(marker) && (!commentAuthor || c.user?.id === commentAuthor.id));
    if (existing?.id) {
      if (isForgeRepo(repo)) {
        await forgeApi(`repos/${repo}/issues/comments/${existing.id}`, { method: "PATCH", body: { body } });
        return `${label} (updated)`;
      }
      await ghAsync(["api", "--method", "PATCH", `repos/${repo}/issues/comments/${existing.id}`, "-f", `body=${body}`]).catch(() =>
        gh(["api", "--method", "PATCH", `repos/${repo}/issues/comments/${existing.id}`, "-f", `body=${body}`]),
      );
      return `${label} (updated)`;
    }
    await createPrComment(r.pr.url, repo, r.pr.number, body);
    return label;
  };

  const posted = [];
  if (triage) posted.push(await upsert("<!-- codeotter:triage -->", formatTriageComment(triage), "triage"));
  for (const [marker, body, label] of extra) posted.push(await upsert(marker, body, label));
  if (postScores) {
    try {
      posted.push(await upsert("<!-- codeotter:scores -->", formatScoresComment(r), "scores"));
    } catch (e) {
      r.commentError = e.message;
    }
  }
  if (postReview) {
    try {
      posted.push(await upsert("<!-- codeotter:review -->", formatReviewComment(r), "review"));
    } catch (e) {
      r.commentError = [r.commentError, e.message].filter(Boolean).join("; ");
    }
  }
  if (postInlineSuggestions) {
    try {
      const inlineRes = await postInlineSuggestionsOnPr(r, repo);
      if (inlineRes.posted > 0) posted.push(`inline suggestions (${inlineRes.posted})`);
    } catch (e) {
      r.commentError = [r.commentError, e.message].filter(Boolean).join("; ");
    }
  }
  if (posted.length) r.commentsPosted = posted;
  return posted;
}

async function score(ref, force, repo) {
  const initial = await startOrPollReview(ref, force, repo);
  if (!initial.pending) return initial;
  const entry = activeReviews.get(initial.pr.url);
  return entry?.promise ? await entry.promise : initial;
}

// <pr-tools>
// PR tools: one language model call each over the pull request and its diff (dynamic context, compressed to the review
// budget). The model answers JSON; the server renders markdown from normalised fields only. The review page runs them
// from one generic card, and PR comment commands run them by id. Results are kept in memory per pull request.
const oneLine = (x, max) => String(x ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const mdCell = (x, max) => oneLine(x, max).replace(/[|`]/g, (ch) => (ch === "|" ? "\\|" : "'"));
const listOf = (x) => (Array.isArray(x) ? x : x == null ? [] : [x]);
async function askJson(c, text, what) {
  const out = await askModel(text, { ...c, temperature: 0.2 });
  try {
    return JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1));
  } catch {
    throw new Error(`${c.provider}/${c.model} did not return valid JSON for ${what}`);
  }
}
const prBrief = (pr, guide) => `PR #${pr.number}: ${pr.title}
Author: ${pr.author?.login || "unknown"}  Base: ${pr.baseRefName} <- Head: ${pr.headRefName}  Files: ${pr.changedFiles}  +${pr.additions} -${pr.deletions}
Description:
${String(pr.body || "(none)").replace(/<!-- codeotter:describe -->[\s\S]*?<!-- \/codeotter:describe -->/, "").trim().slice(0, 3000) || "(none)"}
${guide ? `\nRepository guidelines from ${guide.file}:\n${guide.text.slice(0, 8000)}\n` : ""}`;
async function prToolContext(prUrl) {
  const { urlGuess, spec } = await resolvePr(prUrl, repoOf({ url: prUrl }));
  const [pr, rawDiff, c, rc] = await Promise.all([readPr(urlGuess, spec).then(JSON.parse), readPr(urlGuess, spec, true), llmConfig(), reviewConfig()]);
  if (!c.model) throw new Error("PR tools need a language model: open Admin / Model provider");
  if (c.api === "codereviewer") throw new Error("CodeReviewer only writes per-hunk comments: pick a language model in Admin / Model provider for PR tools");
  let diff = rawDiff;
  if (rc.contextLines > 0) diff = extendDiffContext(rawDiff, await headFileTexts(pr, dynamicContextFiles(parseDiff(rawDiff))), { before: rc.contextLines, after: 1 }).diff;
  const repo = repoOf(pr);
  const guide = await guideFor(repo, isForgeRepo(repo) ? pr.headRefOid : pr.headRefName, pr.headRepo || repo).catch(() => null);
  return { pr, repo, c, rc, guide, diff: compressDiff(diff, Math.min(rc.diffChars, c.contextChars || Infinity)).diff };
}

const DESCRIBE_TYPES = ["Bug fix", "Feature", "Refactor", "Performance", "Security", "Tests", "Docs", "Config", "Dependencies", "Chore"];
const DESCRIBE_RE = /<!-- codeotter:describe -->[\s\S]*?<!-- \/codeotter:describe -->/;
async function updatePrBody(pr, body) {
  const { repo, number } = parsePrUrl(pr.url);
  if (isForgeRepo(repo)) return forgeApi(`repos/${repo}/pulls/${number}`, { method: "PATCH", body: { body } });
  return ghAsync("api", "--method", "PATCH", `repos/${repo}/pulls/${number}`, "-f", `body=${body}`);
}
const PR_TOOLS = {
  describe: {
    label: "Describe",
    applyLabel: "Update PR description",
    async run({ pr, c, guide, diff }) {
      const out = await askJson(c, `Write the description of this pull request for its reviewers, from the diff. Follow the title conventions of the repository guidelines if they set any. Reply with ONLY a JSON object:
{"title":"imperative title under 72 characters","type":["one or more of: ${DESCRIBE_TYPES.join(", ")}"],"summary":["2-5 bullets: what changed and why"],"files":[{"file":"path","change":"one line"}]}

${prBrief(pr, guide)}
Diff:
${diff}`, "Describe");
      const title = oneLine(out.title, 120) || pr.title;
      const types = listOf(out.type).filter((t) => DESCRIBE_TYPES.includes(t));
      const summary = listOf(out.summary).map((s) => oneLine(s, 400)).filter(Boolean).slice(0, 8);
      const files = listOf(out.files).filter((f) => f && typeof f.file === "string").slice(0, 80).map((f) => ({ file: mdCell(f.file, 300), change: mdCell(f.change, 300) }));
      if (!summary.length) throw new Error(`${c.provider}/${c.model} returned no summary for Describe`);
      const markdown = [
        `**Title:** ${title}`,
        ...(types.length ? ["", `**Type:** ${types.join(", ")}`] : []),
        "", "**Summary**", ...summary.map((s) => `- ${s}`),
        ...(files.length ? ["", "**Changes**", "| File | Change |", "| :--- | :--- |", ...files.map((f) => `| \`${f.file}\` | ${f.change} |`)] : []),
      ].join("\n");
      return { markdown, data: { title, types, summary, files } };
    },
    // Writes the generated block into the PR body, keeping the author's own text; a later run replaces the block.
    async apply({ pr }, result) {
      const block = `<!-- codeotter:describe -->\n### 🦦 CodeOtter description\n\n${result.markdown}\n<!-- /codeotter:describe -->`;
      const body = String(pr.body || "");
      await updatePrBody(pr, DESCRIBE_RE.test(body) ? body.replace(DESCRIBE_RE, () => block) : `${body.trimEnd()}${body.trim() ? "\n\n" : ""}${block}`);
      return "PR description updated";
    },
  },
  ask: {
    label: "Ask",
    input: "Question",
    async run({ pr, c, guide, diff }, question) {
      const out = await askJson(c, `Answer a question about this pull request from its diff. Be specific: name files, functions and lines. If the diff does not show enough to answer, say what is missing instead of guessing. Reply with ONLY a JSON object: {"answer":"markdown"}

Question: ${question}

${prBrief(pr, guide)}
Diff:
${diff}`, "Ask");
      const answer = proseOf(out.answer, 6000);
      if (!answer) throw new Error(`${c.provider}/${c.model} returned no answer`);
      return { markdown: `**Q:** ${oneLine(question, 500)}\n\n${answer}`, data: { question: oneLine(question, 2000), answer } };
    },
  },
  improve: {
    label: "Improve",
    applyLabel: "Post inline suggestions",
    // Code suggestions only (no scores): each replaces a line range of the new file, then the self-check scores them.
    async run({ pr, c, rc, guide, diff }) {
      const out = await askJson(c, `Suggest concrete code improvements to the lines this pull request adds or changes (lines starting with "+" in the diff): bugs, missing error handling, security, performance, clarity. Each suggestion replaces lines start_line..end_line of the new file with "improved", which must be complete, correctly indented code for exactly those lines. Do not suggest adding comments or docstrings, reformatting, or restating the code. Reply with ONLY a JSON object:
{"suggestions":[{"file":"path","start_line":10,"end_line":12,"label":"one of: ${IMPROVE_LABELS.join(", ")}","title":"short","why":"one or two sentences","improved":"replacement code"}]}
At most ${rc.maxFindings} suggestions, most important first. An empty list is a valid answer.

${prBrief(pr, guide)}
Diff:
${diff}`, "Improve");
      let items = suggestionItems(out, diff, IMPROVE_LABELS, "enhancement");
      if (rc.reflectMin > 0 && items.length) items = await reflectFindings(pr, diff, c, rc, items);
      items = items.slice(0, rc.maxFindings);
      return { markdown: suggestionsMarkdown(items), data: { suggestions: items } };
    },
    apply: postSuggestions,
  },
  docs: {
    label: "Docs",
    applyLabel: "Post inline suggestions",
    // Docstrings for functions and classes this PR adds or changes that have none, in the language's own convention.
    async run({ pr, c, rc, guide, diff }) {
      const out = await askJson(c, `Write documentation for functions, methods and classes that this pull request adds or changes (lines starting with "+" in the diff) and that have no doc comment. Use the language's convention (JSDoc, Python docstring, Go doc comment, Rust ///, and so on) and the style already used in the file. Say what it does, its parameters, what it returns and what it throws; nothing the name already says. Each suggestion replaces lines start_line..end_line of the new file (the declaration line, or the lines the docstring goes into) with "improved": the documentation plus those same lines, unchanged and correctly indented. Reply with ONLY a JSON object:
{"suggestions":[{"file":"path","start_line":10,"end_line":10,"title":"Document functionName","improved":"documentation and the original lines"}]}
At most ${rc.maxFindings} suggestions. An empty list is a valid answer.

${prBrief(pr, guide)}
Diff:
${diff}`, "Docs");
      const items = suggestionItems(out, diff, ["documentation"], "documentation").slice(0, rc.maxFindings);
      return { markdown: suggestionsMarkdown(items), data: { suggestions: items } };
    },
    apply: postSuggestions,
  },
  changelog: {
    label: "Changelog",
    // An entry in the style of the repository's own changelog (read from the PR head), for the author to paste.
    async run({ pr, c, guide, diff }) {
      const files = await headFileTexts(pr, CHANGELOG_FILES);
      const [file, text] = [...files].find(([, t]) => t.trim()) || [];
      const out = await askJson(c, `Write the changelog entry for this pull request${file ? `, matching the format, tense and level of detail of the existing ${file} below` : " as Keep a Changelog bullets"}. Describe user-visible behaviour, not implementation. Reply with ONLY a JSON object: {"entry":"markdown lines to add under the unreleased section"}
${file ? `\nExisting ${file} (start):\n${text.slice(0, 3000)}\n` : ""}
${prBrief(pr, guide)}
Diff:
${diff}`, "Changelog");
      const entry = proseOf(out.entry, 3000);
      if (!entry) throw new Error(`${c.provider}/${c.model} returned no changelog entry`);
      return { markdown: `${file ? `For \`${file}\`:` : "No changelog file found at the repository root."}\n\n\`\`\`markdown\n${entry.replace(/```/g, "'''")}\n\`\`\``, data: { file: file || null, entry } };
    },
  },
};
const IMPROVE_LABELS = ["possible issue", "security", "performance", "error handling", "maintainability", "enhancement"];
const CHANGELOG_FILES = ["CHANGELOG.md", "CHANGES.md", "HISTORY.md"];
// Model suggestions -> findings with a line range, a label from `labels`, and cleaned prose.
const suggestionItems = (out, diff, labels, fallback) => listOf(out.suggestions)
  .filter((s) => s && typeof s.file === "string" && Number(s.end_line) > 0 && typeof s.improved === "string" && s.improved.trim())
  .slice(0, 20)
  .map((s) => {
    const label = labels.includes(s.label) ? s.label : fallback;
    const f = deriveSuggestionFromDetail({ file: s.file, line: Number(s.end_line), startLine: Number(s.start_line), severity: ["possible issue", "security"].includes(label) ? "medium" : "low", title: oneLine(s.title, 200), detail: proseOf(s.why, 1000), suggestion: s.improved }, diff);
    return { ...f, label };
  });
const fenceFor = (code) => "`".repeat(Math.max(3, ...[...String(code).matchAll(/`+/g)].map((m) => m[0].length + 1)));
const suggestionsMarkdown = (items) => items.length
  ? items.map((f, i) => [
      `**${i + 1}. ${mdCell(f.title, 200)}** · \`${mdCell(f.file, 300)}:L${f.startLine ? `${f.startLine}-` : ""}${f.line}\` · ${f.label}${typeof f.confidence === "number" ? ` · ${Math.round(f.confidence * 10)}/10` : ""}`,
      ...(f.detail ? ["", f.detail] : []),
      "", fenceFor(f.suggestion), f.suggestion, fenceFor(f.suggestion),
    ].join("\n")).join("\n\n")
  : "No suggestions.";
async function postSuggestions({ pr }, result) {
  const findings = result.data?.suggestions || [];
  if (!findings.length) throw new Error("No suggestions to post");
  const { posted, mode } = await postInlineSuggestionsOnPr({ pr, review: { findings } }, repoOf(pr));
  return `Posted ${posted} suggestion(s)${mode === "pr_comment_fallback" ? " as a PR comment (lines outside the diff)" : ""}`;
}
// Model prose posted to a PR: no HTML comments (they could forge CodeOtter's comment markers) and no live @mentions.
const proseOf = (x, max) => String(x ?? "").replace(/<!--[\s\S]*?(-->|$)/g, "").replace(/(^|[^\w`])@(?=[\w-])/g, "$1@\u200b").trim().slice(0, max);
const toolResults = new Map();
async function runPrTool(prUrl, id, { question = "", action = "run" } = {}) {
  const tool = PR_TOOLS[id];
  if (!tool) throw new Error(`Unknown tool ${id}`);
  const key = `${prUrl}#${id}`;
  if (action === "run") {
    if (tool.input && !oneLine(question, 2000)) throw new Error(`${tool.label} needs ${tool.input.toLowerCase()}`);
    const ctx = await prToolContext(prUrl);
    const result = { tool: id, label: tool.label, ...(await tool.run(ctx, oneLine(question, 2000))), headSha: ctx.pr.headRefOid || "", at: new Date().toISOString() };
    toolResults.set(key, result);
    return result;
  }
  const result = toolResults.get(key);
  if (!result) throw new Error(`Run ${tool.label} first`);
  if (action === "comment") {
    const pr = { url: prUrl, number: parsePrUrl(prUrl).number };
    const body = `<!-- codeotter:tool:${id} -->\n### 🦦 CodeOtter · ${tool.label}\n\n${result.markdown}\n\n---\n🔗 **[Open on CodeOtter →](${APP_URL}/review?pr=${encodeURIComponent(prUrl)})**`;
    await syncPrComments({ pr }, repoOf(pr), { extra: [[`<!-- codeotter:tool:${id} -->`, body, tool.label]] });
    return { ...result, message: "Posted as a PR comment" };
  }
  if (action === "apply" && tool.apply) {
    const { urlGuess, spec } = await resolvePr(prUrl, repoOf({ url: prUrl }));
    return { ...result, message: await tool.apply({ pr: JSON.parse(await readPr(urlGuess, spec)) }, result) };
  }
  throw new Error("Unknown action");
}
// </pr-tools>

// <pr-commands>
// PR comment commands: a comment whose first line is /review, /describe, /improve, /docs, /changelog or /ask <question>
// runs that action and replies on the pull request. Off unless enabled in Settings, and only the repository's owner,
// members and collaborators can trigger one: anyone can comment on a public repository and spend its model budget.
const COMMANDS = ["review", "describe", "improve", "ask", "docs", "changelog"];
function parseCommand(body) {
  const m = String(body || "").trimStart().split("\n")[0].trim().match(/^\/([a-z]+)(?:\s+(.*))?$/i);
  if (!m || !COMMANDS.includes(m[1].toLowerCase())) return null;
  return { cmd: m[1].toLowerCase(), arg: String(m[2] || "").trim().slice(0, 2000) };
}
// The pull request a comment belongs to, from its web link (GitHub /pull/7#..., Forgejo and Gitea /pulls/7#...).
const commentPrNumber = (c) => Number((String(c?.html_url || "").match(/\/pulls?\/([1-9]\d*)(?:#|$)/) || [])[1]) || 0;
async function commenterTrusted(repo, c) {
  if (!isForgeRepo(repo)) return ["OWNER", "MEMBER", "COLLABORATOR"].includes(c.author_association);
  const login = String(c.user?.login || "");
  if (!/^[\w][\w.-]*$/.test(login)) return false;
  try {
    const p = await forgeApi(`repos/${repo}/collaborators/${encodeURIComponent(login)}/permission`);
    return ["owner", "admin", "write"].includes(String(p?.permission || "").toLowerCase());
  } catch (e) {
    if ([403, 404].includes(e.status)) return false;
    throw e;
  }
}
async function commentsSince(repo, since) {
  if (isForgeRepo(repo)) return forgeApi(`repos/${repo}/issues/comments?since=${encodeURIComponent(since)}&limit=50`);
  return JSON.parse(await ghAsync("api", `repos/${repo}/issues/comments?since=${encodeURIComponent(since)}&sort=created&direction=asc&per_page=100`));
}
async function runCommand(repo, c, { cmd, arg }) {
  const number = commentPrNumber(c);
  const prUrl = prUrlFor(repo, number);
  const id = Number(c.id);
  if (Number.isSafeInteger(id) && id > 0) {
    await (isForgeRepo(repo)
      ? forgeApi(`repos/${repo}/issues/comments/${id}/reactions`, { method: "POST", body: { content: "eyes" } })
      : ghAsync("api", "--method", "POST", `repos/${repo}/issues/comments/${id}/reactions`, "-f", "content=eyes")).catch(() => {});
  }
  try {
    if (cmd === "review") {
      await syncPrComments(await score(prUrl, true, repo), repo, { postScores: true, postReview: true });
    } else {
      await runPrTool(prUrl, cmd, { question: arg });
      await runPrTool(prUrl, cmd, { action: "comment" });
    }
  } catch (e) {
    await createPrComment(prUrl, repo, number, `🦦 CodeOtter \`/${cmd}\` failed: ${oneLine(e.message, 500)}`).catch(() => {});
    throw e;
  }
}
// </pr-commands>
// Every minute: each onboarded repository's comments since the last poll, oldest first. The first poll after enabling
// looks back five minutes, so older comments never fire.
let commandPolling = false;
setInterval(async () => {
  if (commandPolling) return;
  commandPolling = true;
  try {
    if (!(await reviewConfig()).commands) return;
    const seen = (await store.getSetting("commandsSeen")) || {};
    for (const repo of await repos()) {
      const since = seen[repo] || new Date(Date.now() - 5 * 60e3).toISOString();
      let list;
      try {
        list = await commentsSince(repo, since);
      } catch (e) {
        console.warn(`[commands] ${repo}: ${e.message}`);
        continue;
      }
      let latest = since;
      for (const c of Array.isArray(list) ? list : []) {
        const at = String(c?.created_at || "");
        if (!at || Date.parse(at) <= Date.parse(since)) continue;
        if (Date.parse(at) > Date.parse(latest)) latest = new Date(Date.parse(at)).toISOString();
        const command = parseCommand(c.body);
        if (!command || !commentPrNumber(c)) continue;
        if (!(await commenterTrusted(repo, c).catch(() => false))) continue;
        await runCommand(repo, c, command).catch((e) => console.warn(`[commands] ${repo} /${command.cmd}: ${e.message}`));
      }
      seen[repo] = latest;
      await store.setSetting("commandsSeen", seen);
    }
  } catch (e) {
    console.warn(`[commands] ${e.message}`);
  } finally {
    commandPolling = false;
  }
}, 60e3).unref();

function formatScoresComment(r) {
  const { pr, blast, review: v, gates = [], linkedIssues = [], headSha, incremental } = r;
  const appLink = `${APP_URL}/review?pr=${encodeURIComponent(pr.url)}`;
  const levelOf = (key, val) => S1_SCORES[key]?.[Math.min(4, Math.max(0, Math.round((Number(val) || 0) / 25)))] || "";
  const rows = [
    ["Quality", v.scores.quality, levelOf("quality", v.scores.quality)],
    ["Blast radius", blast.score, levelOf("blast_radius", blast.score)],
    ["Correctness risk", v.scores.correctness_risk, levelOf("correctness_risk", v.scores.correctness_risk)],
    ["Test coverage", v.scores.test_coverage, levelOf("test_coverage", v.scores.test_coverage)],
    ["Readability", v.scores.readability, levelOf("readability", v.scores.readability)],
    ["PR hygiene", v.scores.pr_hygiene, levelOf("pr_hygiene", v.scores.pr_hygiene)],
  ];
  const shaNote = incremental
    ? `⚡ **Incremental delta:** \`${incremental.prevSha.slice(0, 7)}\` → \`${incremental.headSha.slice(0, 7)}\` (${incremental.newCommits.length} new commit${incremental.newCommits.length === 1 ? "" : "s"})`
    : headSha
      ? `**Reviewed commit:** \`${headSha.slice(0, 7)}\``
      : "";
  const lines = [
    `<!-- codeotter:scores -->`,
    `### 🦦 CodeOtter — Review Scores`,
    ...(shaNote ? ["", shaNote] : []),
    ...(linkedIssues.length
      ? ["", `**Linked issue(s):** ${linkedIssues.map((i) => `[#${i.number} ${i.title}](${i.url})`).join(" · ")}`]
      : []),
    "",
    `| Metric | Score | Assessment |`,
    `| :--- | :---: | :--- |`,
    ...rows.map(([label, score, desc]) => `| **${label}** | **${score}** / 100 | ${desc} |`),
  ];
  const checkRows = [
    ...gates.map((g) => `| ${g.label} | ${g.pass ? "✅ Passed" : "⚠️ Warning"} (${Math.round(g.yes * 100)}% yes) |`),
    ...(linkedIssues.length && !gates.some((g) => g.id === "issue_requirements")
      ? [`| Issue requirements | ${v.verdict !== "request_changes" && v.scores.quality >= 60 ? "✅ Passed" : "⚠️ Warning"} (${linkedIssues.map((i) => `#${i.number}`).join(", ")}) |`]
      : []),
  ];
  if (checkRows.length) {
    lines.push(
      "",
      "#### Pre-merge checks",
      "| Gate | Status |",
      "| :--- | :--- |",
      ...checkRows,
    );
  }
  lines.push(
    "",
    `---`,
    `🔗 **[View full review details on CodeOtter →](${appLink})**`,
  );
  return lines.join("\n");
}
const formatScorecardComment = formatScoresComment;

function cleanMermaidText(s, max = 42) {
  const clean = String(s || "")
    .replace(/["[\]`<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function buildBlastMermaid(r) {
  const { pr: p, blast: b = {}, review: v = {} } = r;
  const files = p.files?.length
    ? p.files
    : (v.walkthrough || []).map((w) => ({ path: w.file, additions: 0, deletions: 0 }));
  const walkMap = new Map();
  for (const w of v.walkthrough || []) {
    if (w?.file && w?.change) walkMap.set(w.file, w.change);
  }

  const out = [
    "flowchart LR",
    "  classDef pr fill:#111c2d,stroke:#38bdf8,stroke-width:2px,color:#f8fafc",
    "  classDef cohort fill:#131b26,stroke:#64748b,stroke-width:1.5px,color:#f1f5f9",
    "  classDef file fill:#0b1017,stroke:#334155,stroke-width:1px,color:#e2e8f0",
    "  classDef hotspot fill:#291507,stroke:#f59e0b,stroke-width:2px,color:#fef3c7",
    "  classDef test fill:#072415,stroke:#22c55e,stroke-width:1.5px,color:#dcfce7",
  ];

  const prHead = cleanMermaidText(p.headRefName || "head", 20);
  const prBase = cleanMermaidText(p.baseRefName || "main", 18);
  out.push(
    `  PR["PR #${p.number}: ${prHead} -> ${prBase}<br/>${p.changedFiles} file(s) (+${p.additions} / -${p.deletions}) · Blast ${b.score ?? 0}/100"]:::pr`,
  );

  const cohortMap = new Map();
  for (const f of files) {
    const parts = f.path.split("/");
    const key = parts.length > 1 ? parts.slice(0, Math.min(2, parts.length - 1)).join("/") : "(root)";
    cohortMap.set(key, [...(cohortMap.get(key) || []), f]);
  }

  const cohortEntries = [...cohortMap.entries()].slice(0, 6);
  const cohortNodeIds = new Map();

  cohortEntries.forEach(([cohortKey, cFiles], cIdx) => {
    const cid = `C${cIdx}`;
    cohortNodeIds.set(cohortKey, cid);
    const add = cFiles.reduce((n, f) => n + (f.additions || 0), 0);
    const del = cFiles.reduce((n, f) => n + (f.deletions || 0), 0);
    out.push(`  ${cid}["${cleanMermaidText(cohortKey, 26)} (${cFiles.length})<br/>+${add} / -${del}"]:::cohort`);
    out.push(`  PR --> ${cid}`);
  });

  let fileCounter = 0;
  const maxFilesShown = 8;
  const hotspotLinks = new Map();
  for (const h of b.hotspots || []) hotspotLinks.set(h, new Set());

  cohortEntries.forEach(([cohortKey, cFiles]) => {
    const cid = cohortNodeIds.get(cohortKey);
    for (const f of cFiles) {
      for (const [hName, re] of HOTSPOTS) {
        if (re.test(f.path)) {
          if (!hotspotLinks.has(hName)) hotspotLinks.set(hName, new Set());
          hotspotLinks.get(hName).add(cid);
        }
      }
      if (fileCounter >= maxFilesShown) continue;
      const fid = `F${fileCounter++}`;
      const base = f.path.split("/").pop() || f.path;
      const isTest = /test|spec|__tests__/i.test(f.path);
      const wChange = walkMap.get(f.path);
      const summaryBit = wChange ? ` · ${cleanMermaidText(wChange, 22)}` : "";
      const role = isTest ? "test" : "file";
      const prefix = isTest ? "🧪 " : "";
      out.push(
        `  ${fid}["${prefix}${cleanMermaidText(base, 24)}<br/>+${f.additions} / -${f.deletions}${summaryBit}"]:::${role}`,
      );
      out.push(`  ${cid} --> ${fid}`);
    }
  });

  if (files.length > maxFilesShown) {
    const rem = files.length - maxFilesShown;
    out.push(`  FMORE["+${rem} more modified file(s)<br/>In ${cohortMap.size} cohort(s)"]:::file`);
    out.push(`  ${cohortNodeIds.values().next().value || "PR"} --> FMORE`);
  }

  let hIdx = 0;
  for (const [hName, fromIds] of hotspotLinks.entries()) {
    const hid = `H${hIdx++}`;
    out.push(`  ${hid}["⚠️ Hotspot: ${cleanMermaidText(hName, 24)}<br/>Blast radius impact"]:::hotspot`);
    if (fromIds.size) {
      for (const src of fromIds) out.push(`  ${src} -.-> ${hid}`);
    } else {
      out.push(`  PR -.-> ${hid}`);
    }
  }

  const testCount = b.testFiles ?? files.filter((f) => /test|spec|__tests__/i.test(f.path)).length;
  if (testCount > 0) {
    out.push(`  TVERIFY["🧪 ${testCount} Test File(s)<br/>Verifying cohort changes"]:::test`);
    const firstCohort = cohortNodeIds.values().next().value || "PR";
    out.push(`  ${firstCohort} --> TVERIFY`);
  } else {
    out.push(`  TNONE["⚠️ 0 Test Files<br/>No test coverage in diff"]:::hotspot`);
    out.push(`  PR -.-> TNONE`);
  }

  if (r.outsideDiffImpact?.callers?.length) {
    out.push("  classDef outside fill:#261205,stroke:#ea580c,stroke-width:1.5px,color:#ffedd5");
    const topCallers = r.outsideDiffImpact.callers.slice(0, 4);
    topCallers.forEach((c, idx) => {
      const ocid = `OC${idx}`;
      const baseFile = c.file.split("/").pop() || c.file;
      out.push(`  ${ocid}["🌐 Outside: ${cleanMermaidText(baseFile, 18)}:${c.line}<br/>calls ${cleanMermaidText(c.symbol, 16)}()"]:::outside`);
      const firstCohort = cohortNodeIds.values().next().value || "PR";
      out.push(`  ${firstCohort} -.->|calls ${cleanMermaidText(c.symbol, 14)}| ${ocid}`);
    });
  }

  return out.join("\n");
}

function formatReviewComment(r) {
  const { pr, blast, review: v, linkedIssues = [], headSha, incremental } = r;
  const appLink = `${APP_URL}/review?pr=${encodeURIComponent(pr.url)}`;
  const [vl] = VERDICT[v.verdict] || ["Commented"];
  const e = effort(blast);
  const actionable = (v.findings || []).filter((f) => !f.dismissed && f.severity !== "nit").map((f) => deriveSuggestionFromDetail(f, ""));
  const resolved = incremental?.resolvedFindings || [];
  const lines = [
    `<!-- codeotter:review -->`,
    `### 🦦 CodeOtter — PR Review Summary`,
    "",
    `**Verdict:** ${vl} · **Review effort:** 🎯 ${e.n} (${e.label}, ~${e.mins} min) · **Actionable findings:** ${actionable.length}${headSha ? ` · **Commit:** \`${headSha.slice(0, 7)}\`` : ""}`,
    ...(incremental
      ? [
          "",
          `⚡ **Incremental delta:** \`${incremental.prevSha.slice(0, 7)}\` → \`${incremental.headSha.slice(0, 7)}\` (${incremental.newCommits.length} new commit${incremental.newCommits.length === 1 ? "" : "s"})${resolved.length ? ` · ✅ **${resolved.length} prior finding${resolved.length === 1 ? "" : "s"} resolved**` : ""}`,
        ]
      : []),
    ...(linkedIssues.length
      ? [
          "",
          `#### Linked Issues & Requirements`,
          ...linkedIssues.map((i) => {
            const req = (i.body || "").trim().replace(/\s+/g, " ").slice(0, 220);
            return `- [#${i.number} ${i.title}](${i.url})${i.state ? ` (${i.state})` : ""}${req ? ` — ${req}${(i.body || "").trim().length > 220 ? "…" : ""}` : ""}`;
          }),
        ]
      : []),
    "",
    `#### Summary`,
    v.summary,
    ...(actionable.length
      ? [
          "",
          `#### Actionable Findings (${actionable.length})`,
          ...actionable.flatMap((f, idx) => {
            const explanation = String(f.detail || "").split("\n\n@@")[0].trim();
            return [
              "",
              `${idx + 1}. **[${String(f.severity || "low").toUpperCase()}] \`${f.file}${f.line ? `:L${f.line}` : ""}\`** — **${f.title}**`,
              ...(explanation ? [`   ${explanation}`] : []),
              ...(f.suggestion
                ? [
                    "```suggestion",
                    String(f.suggestion).replace(/\r?\n$/, ""),
                    "```",
                  ]
                : []),
            ];
          }),
        ]
      : []),
    ...(resolved.length
      ? [
          "",
          `#### ✅ Resolved since \`${incremental.prevSha.slice(0, 7)}\` (${resolved.length})`,
          ...resolved.map((f) => `- ~~**[${f.severity.toUpperCase()}] \`${f.file}\`**: ${f.title}~~`),
        ]
      : []),
    ...(r.outsideDiffImpact?.callers?.length
      ? [
          "",
          `#### 🌐 Outside-Diff Call Graph Impact (${r.outsideDiffImpact.outsideCallers} caller(s) in ${r.outsideDiffImpact.uniqueFiles} un-modified file(s))`,
          "The following un-modified files in the repository depend on symbols altered in this diff (verified for contract & exception safety):",
          ...r.outsideDiffImpact.callers.slice(0, 5).map((c) => `- \`${c.file}:${c.line}\`: calls \`${c.symbol}()\` — \`${c.snippet.slice(0, 100)}\``),
        ]
      : []),
    "",
    `## [2.5/4] Architecture & Blast Radius Graph`,
    "```mermaid",
    buildBlastMermaid(r),
    "```",
    "",
    `---`,
    `🔗 **[View full review details on CodeOtter →](${appLink})**`,
  ];
  return lines.join("\n");
}

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const repoOf = (pr) => parsePrUrl(pr.url)?.repo || "";
const effort = (b) => {
  const n = b.score >= 80 ? 5 : b.score >= 60 ? 4 : b.score >= 40 ? 3 : b.score >= 20 ? 2 : 1;
  return { n, label: ["Trivial", "Simple", "Moderate", "Complex", "Critical"][n - 1], mins: Math.max(5, Math.round(b.lines / 8 / 5) * 5) };
};
const KIND = { high: ["⚠️", "Potential issue", "Major"], medium: ["⚠️", "Potential issue", "Minor"], low: ["🛠️", "Refactor suggestion", ""], nit: ["🧹", "Nitpick", ""] };
const VERDICT = { approve: ["Approved", "ok"], comment: ["Commented", "warn"], request_changes: ["Changes requested", "bad"] };
const tone = (v, invert) => ((invert ? 100 - v : v) >= 70 ? "ok" : (invert ? 100 - v : v) >= 40 ? "warn" : "bad");

const CSS = `
:root{--or:#c2410c;--ink:#111;--txt:#1f1f1f;--mut:#6b6b6b;--b:#e6e6e6;--side:#f7f7f7;--head:#efefef;--ok:#15803d;--warn:#b45309;--bad:#b91c1c}
*{box-sizing:border-box}body{margin:0;font:14px/1.5 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--txt);background:#fff;display:flex;min-height:100vh}
a{color:var(--or);text-decoration:none}a:hover{text-decoration:underline}
aside{width:300px;flex:none;background:var(--side);border-right:1px solid var(--b);padding:14px 12px;display:flex;flex-direction:column;gap:2px}
.who{display:flex;align-items:center;gap:8px;padding:6px 8px 14px;font-weight:600}.who .av{width:26px;height:26px;border-radius:50%;background:linear-gradient(135deg,#f59e0b,#c2410c)}.who .pill{font-weight:500;font-size:12px;background:#e8e8e8;border-radius:6px;padding:1px 8px;color:#444}
.grp{font-size:12px;color:#555;padding:14px 8px 6px}.nav{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;color:#333;font-size:15px}.nav:hover{background:#ededed;text-decoration:none}.nav.on{background:#e9e9e9;color:var(--txt)}
.nav svg{width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:1.8;flex:none}.nav .r{margin-left:auto;font-size:12px;color:#777}.nav .r.bd{background:#fde7d3;color:#9a3412;border-radius:6px;padding:0 7px}.nav .r.gr{background:#e4e4e4;border-radius:6px;padding:0 7px;color:#333}
.sub{display:block;margin-left:22px;padding:6px 10px 6px 14px;border-left:2px solid #ddd;color:#333;font-size:15px}.sub.on{border-color:var(--or);color:var(--or)}.sub:hover{text-decoration:none;color:var(--or)}
hr{border:0;border-top:1px solid var(--b);margin:12px 0}
section{flex:1;min-width:0}
.top{display:flex;align-items:center;justify-content:space-between;padding:14px 28px;border-bottom:1px solid var(--b);font-size:16px}
.btn{border:1px solid var(--b);background:#fff;border-radius:8px;padding:8px 14px;font:inherit;font-size:14px;cursor:pointer;color:var(--txt)}.btn.pri{background:var(--ink);color:#fff;border-color:var(--ink);font-weight:500}
.wrap{max-width:1220px;margin:0 auto;padding:28px 40px}
.lead{font-size:15px;color:#333;margin:0 0 18px}
form.bar{display:flex;gap:10px;margin-bottom:16px}form.bar input{flex:1;max-width:420px;border:1px solid var(--b);border-radius:8px;padding:9px 12px 9px 36px;font:inherit;background:#fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23777' stroke-width='2'%3E%3Ccircle cx='11' cy='11' r='7'/%3E%3Cpath d='m20 20-3.5-3.5'/%3E%3C/svg%3E") 11px center/15px no-repeat}
.tbl{border:1px solid var(--b);border-radius:10px;overflow:hidden}.tbl table{width:100%;border-collapse:collapse}.tbl th{background:var(--head);text-align:left;font-weight:500;color:#444;padding:11px 16px;font-size:14px}.tbl td{padding:13px 16px;border-top:1px solid var(--b);font-size:15px;vertical-align:top}
.tbl td a.act{float:right;white-space:nowrap}.tbl td a.act::after{content:" →"}
.pill{display:inline-block;font-size:12px;border-radius:6px;padding:1px 8px;background:#e8e8e8;color:#444;margin-left:6px;vertical-align:middle}.pill.ok{background:#dcfce7;color:#166534}.pill.warn{background:#fef3c7;color:#92400e}.pill.bad{background:#fee2e2;color:#991b1b}
.pg{display:flex;justify-content:flex-end;margin-top:14px}.pg span{border:1px solid var(--b);border-radius:8px;padding:8px 14px;color:#444}
.cmt{border:1px solid var(--b);border-radius:10px;margin:0 0 16px}.cmt .hd{display:flex;align-items:center;gap:8px;background:var(--head);padding:9px 16px;border-bottom:1px solid var(--b);font-size:14px}.cmt .hd .bot{width:20px;height:20px;border-radius:50%;background:var(--or);display:inline-block}.cmt .hd b{font-weight:600}.cmt .hd .mut{color:var(--mut)}.cmt .bd{padding:16px 20px;font-size:15px}
h3{font-size:18px;margin:0 0 10px}h4{font-size:15px;margin:18px 0 8px}details{margin:8px 0}summary{cursor:pointer;font-weight:600;color:#333}
table.md{width:100%;border-collapse:collapse;font-size:14px;margin:6px 0}table.md th,table.md td{border:1px solid var(--b);padding:7px 10px;text-align:left;vertical-align:top}table.md th{background:#f6f6f6;font-weight:600}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px;background:#f2f2f2;border-radius:5px;padding:1px 6px}
.fnd{border:1px solid var(--b);border-radius:8px;margin:10px 0;overflow:hidden}.fnd .fh{background:#f6f6f6;padding:7px 12px;font-size:13px;color:#444;border-bottom:1px solid var(--b)}.fnd .fb{padding:12px 14px}.fnd .fb b{display:block;margin-bottom:4px}.fnd .fb b .sev{font-weight:500;color:var(--mut);font-size:12px;margin-left:6px}
.rings{display:flex;flex-wrap:wrap;gap:16px;margin:6px 0 4px}.ring{width:88px;height:88px;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;background:conic-gradient(var(--c) calc(var(--v)*1%),#e9e9e9 0);position:relative}.ring::before{content:"";position:absolute;inset:7px;border-radius:50%;background:#fff}.ring b,.ring span{position:relative}.ring b{font-size:20px}.ring span{font-size:11px;color:var(--mut);text-align:center;line-height:1.1}.ok{--c:var(--ok)}.warn{--c:var(--warn)}.bad{--c:var(--bad)}
.mut{color:var(--mut)}.tag{display:inline-block;font-size:12px;border-radius:999px;padding:2px 10px;background:#fde7d3;color:#9a3412;margin:2px 6px 2px 0}
.ft{display:flex;gap:16px;border-top:1px solid var(--b);margin-top:14px;padding-top:10px;font-size:13px;color:var(--mut)}
pre{white-space:pre-wrap}`;

const I = {
  puzzle: '<svg viewBox="0 0 24 24"><path d="M14 3a2 2 0 0 1 2 2v2h3v4h-2a2 2 0 0 0 0 4h2v4h-4v-2a2 2 0 0 0-4 0v2H7v-4H5a2 2 0 0 1 0-4h2V7h3V5a2 2 0 0 1 2-2z"/></svg>',
  doc: '<svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg>',
  shield: '<svg viewBox="0 0 24 24"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="m9 12 2 2 4-4"/></svg>',
  code: '<svg viewBox="0 0 24 24"><path d="m8 8-4 4 4 4M16 8l4 4-4 4M14 4l-4 16"/></svg>',
  bolt: '<svg viewBox="0 0 24 24"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>',
  slack: '<svg viewBox="0 0 24 24"><path d="M9 3v6m6 6v6M3 15h6m6-6h6M9 15H6a3 3 0 1 0 3 3zM15 9h3a3 3 0 1 0-3-3z"/></svg>',
  card: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/></svg>',
  users: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0M16 4a3 3 0 0 1 0 6M21 20a6 6 0 0 0-4-5.7"/></svg>',
  book: '<svg viewBox="0 0 24 24"><path d="M4 4h6a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4zM20 4h-6a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h7z"/></svg>',
  chev: '<svg viewBox="0 0 24 24" style="margin-left:auto;width:14px"><path d="m6 9 6 6 6-6"/></svg>',
};

const sidebar = () => `<aside>
<div class="who"><span class="av"></span>${esc(REPO.split("/")[0])} <span class="pill">Local</span></div>
<div class="grp">General</div>
<a class="nav on" href="/">${I.puzzle}General${I.chev}</a>
<a class="sub on" href="/">Reviews</a>
<a class="sub" href="/#open">Open pull requests</a>
<hr>
<a class="nav" href="https://github.com/${esc(REPO)}/pulls">${I.book}GitHub</a>
</aside>`;

const page = (title, actions, body) =>
  `<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width"><title>${esc(title)}</title><style>${CSS}</style></head><body>${sidebar()}
<section><div class="top"><span>${esc(title)}</span><span style="display:flex;gap:10px">${actions}</span></div><div class="wrap">${body}</div></section></body></html>`;

async function openPrs(repo) {
  if (isForgeRepo(repo)) return (await forgeList(`repos/${repo}/pulls?state=open`)).map((p) => normalizeForgePr(p, repo));
  try {
    return JSON.parse(gh("pr", "list", "-R", repo, "--json", "number,title,author,url,updatedAt,additions,deletions,changedFiles,headRefOid", "--limit", "30"));
  } catch {
    return [];
  }
}

async function renderHome() {
  const reviewed = await store.all();
  const done = new Set(reviewed.map((r) => r.pr.url));
  const rows = reviewed
    .map((r) => {
      const [vl, vt] = VERDICT[r.review.verdict] || ["Commented", "warn"];
      const e = effort(r.blast);
      return `<tr><td><a href="/score?pr=${encodeURIComponent(r.pr.url)}">#${r.pr.number}</a> ${esc(r.pr.title)}<span class="pill">${esc(repoOf(r.pr))}</span></td>
      <td>🎯 ${e.n} (${e.label})</td><td><span class="pill ${tone(r.review.scores.quality)}">${r.review.scores.quality}</span></td><td><span class="pill ${tone(r.blast.score, true)}">${r.blast.score}</span></td>
      <td><span class="pill ${vt}">${vl}</span><a class="act" href="/score?pr=${encodeURIComponent(r.pr.url)}">Review details</a></td></tr>`;
    })
    .join("");
  const open = (await Promise.all((await repos()).map(openPrs))).flat()
    .filter((p) => !done.has(p.url))
    .map((p) => `<tr><td><a href="${p.url}">#${p.number}</a> ${esc(p.title)}</td><td>${esc(p.author.login)}</td><td>${p.changedFiles} files <span style="color:var(--ok)">+${p.additions}</span> <span style="color:var(--bad)">-${p.deletions}</span></td>
      <td><a class="act" href="/score?pr=${encodeURIComponent(p.url)}">Review</a></td></tr>`)
    .join("");
  return page(
    "Reviews",
    `<button class="btn pri" form="f">Review pull request</button>`,
    `<p class="lead">Pull requests reviewed for quality, blast radius and actionable comments.</p>
    <form class="bar" id="f" action="/score"><input name="pr" placeholder="Paste a pull request URL or number in ${esc(REPO)}" autofocus></form>
    <div class="tbl"><table><tr><th>Pull request</th><th>Review effort</th><th>Quality</th><th>Blast radius</th><th></th></tr>${rows || `<tr><td colspan=5 class="mut">No reviews yet.</td></tr>`}</table></div>
    <h4 id="open" style="margin-top:28px">Open pull requests in ${esc(REPO)}</h4>
    <div class="tbl"><table><tr><th>Pull request</th><th>Author</th><th>Size</th><th></th></tr>${open || `<tr><td colspan=4 class="mut">Nothing waiting for review.</td></tr>`}</table></div>`,
  );
}

function cohorts(files) {
  const m = new Map();
  for (const w of files) {
    const k = w.file.split("/").slice(0, 3).join("/");
    (m.get(k) || m.set(k, []).get(k)).push(w);
  }
  return [...m].map(([k, ws]) => `<tr><td><b>${esc(k)}</b><br>${ws.map((w) => `<code>${esc(w.file.split("/").pop())}</code>`).join(" ")}</td><td>${ws.map((w) => esc(w.change)).join("<br>")}</td></tr>`).join("");
}

function renderScore(r) {
  const { pr, blast, review: v } = r;
  const [vl, vt] = VERDICT[v.verdict] || ["Commented", "warn"];
  const e = effort(blast);
  const actionable = (v.findings || []).filter((f) => !f.dismissed && f.severity !== "nit");
  const nits = (v.findings || []).filter((f) => !f.dismissed && f.severity === "nit");
  const finding = (rawF) => {
    const f = deriveSuggestionFromDetail(rawF, "");
    const [ic, kind, sev] = KIND[f.severity] || KIND.low;
    return `<div class="fnd"><div class="fh"><code>${esc(f.file)}${f.line ? `:L${f.line}` : ""}</code></div><div class="fb"><b>${ic} ${kind}${sev ? `<span class="sev">| 🔴 ${sev}</span>` : ""}</b><b style="font-weight:600">${esc(f.title)}</b><span>${esc(f.detail)}</span>${f.suggestion ? `<pre style="margin-top:8px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:6px;padding:8px 10px;color:#065f46;font-size:12.5px">+ ${esc(f.suggestion)}</pre>` : ""}</div></div>`;
  };
  const when = new Date(r.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  return page(
    `Reviews / #${pr.number}`,
    `<a class="btn" href="/score?pr=${encodeURIComponent(pr.url)}&force=1">Re-review</a><a class="btn pri" href="${pr.url}" style="text-decoration:none">Open pull request</a>`,
    `<h3>${esc(pr.title)} <span class="pill ${vt}">${vl}</span></h3>
    <p class="mut" style="margin:0 0 18px">${esc(repoOf(pr))} &middot; ${esc(pr.author.login)} wants to merge <code>${esc(pr.headRefName)}</code> into <code>${esc(pr.baseRefName)}</code> &middot; ${pr.changedFiles} files changed <span style="color:var(--ok)">+${pr.additions}</span> <span style="color:var(--bad)">-${pr.deletions}</span></p>

    <div class="cmt"><div class="hd"><span class="bot"></span><b>CodeOtter</b><span class="mut">commented ${esc(when)}</span></div><div class="bd">
      <h4 style="margin-top:0">Walkthrough</h4><p>${esc(v.summary)}</p>
      <h4>Changes</h4><table class="md"><tr><th style="width:38%">Cohort / File(s)</th><th>Summary</th></tr>${cohorts(v.walkthrough || [])}</table>
      <h4>Estimated code review effort</h4><p>🎯 ${e.n} (${e.label}) | ⏱️ ~${e.mins} minutes</p>
      <h4>Scores</h4><div class="rings">
        ${[["Quality", v.scores.quality], ["Blast radius", blast.score, 1], ["Risk", v.scores.correctness_risk, 1], ["Tests", v.scores.test_coverage], ["Readability", v.scores.readability], ["PR hygiene", v.scores.pr_hygiene]]
          .map(([l, n, inv]) => `<div class="ring ${tone(n, inv)}" style="--v:${n}"><b>${n}</b><span>${l}</span></div>`).join("")}
      </div>
      <details><summary>Blast radius details</summary><p>${blast.files} files &middot; ${blast.lines} lines &middot; ${blast.dirs} areas &middot; ${blast.testFiles} test files</p>${blast.hotspots.map((h) => `<span class="tag">${esc(h)}</span>`).join("") || "<span class=mut>No hotspots touched.</span>"}</details>
      <details><summary>Pre-merge checks</summary><table class="md"><tr><th>Check</th><th>Status</th></tr>
        ${(r.gates || []).length ? "" : `<tr><td>Title check</td><td>${v.scores.pr_hygiene >= 60 ? "✅ Passed" : "⚠️ Warning"}</td></tr>
        <tr><td>Description check</td><td>${(pr.body || "").length > 80 ? "✅ Passed" : "⚠️ Warning"}</td></tr>`}
        <tr><td>Tests touched</td><td>${blast.testFiles ? "✅ Passed" : "⚠️ Warning"}</td></tr>
        ${(r.gates || []).map((g) => `<tr><td>${esc(g.label)}</td><td>${g.pass ? "✅ Passed" : "⚠️ Warning"} <span class="mut">(${Math.round(g.yes * 100)}% yes)</span></td></tr>`).join("")}</table></details>
      <div class="ft"><span>Reviewed ${esc(when)}</span></div>
    </div></div>

    <div class="cmt"><div class="hd"><span class="bot"></span><b>CodeOtter</b><span class="mut">reviewed ${esc(when)}</span></div><div class="bd">
      <p style="margin-top:0"><b>Actionable comments posted: ${actionable.length}</b></p>
      ${actionable.map(finding).join("") || "<p class=mut>None.</p>"}
      ${nits.length ? `<details open><summary>🧹 Nitpick comments (${nits.length})</summary>${nits.map(finding).join("")}</details>` : ""}
      <details><summary>📜 Review details</summary><p><b>Configuration used:</b> defaults<br><b>Review profile:</b> ASSERTIVE<br><b>Files selected for processing (${pr.files.length})</b></p><ul>${pr.files.map((f) => `<li><code>${esc(f.path)}</code> <span class="mut">(+${f.additions} -${f.deletions})</span></li>`).join("")}</ul></details>
    </div></div>`,
  );
}

const DIST = join(import.meta.dirname, "web", "dist");
if (!existsSync(DIST)) {
  console.log("web/dist not found. Building web frontend...");
  try {
    const isWin = process.platform === "win32";
    const pnpmCmd = isWin ? "pnpm.cmd" : "pnpm";
    execFileSync(pnpmCmd, ["-C", join(import.meta.dirname, "web"), "build"], { stdio: "inherit" });
  } catch (err) {
    console.warn("Could not auto-build web frontend:", err.message);
  }
}
const MIME = { html: "text/html", js: "text/javascript", css: "text/css", svg: "image/svg+xml", png: "image/png", ico: "image/x-icon", json: "application/json", webmanifest: "application/manifest+json", woff2: "font/woff2" };
const CODEOTTER_PATH_TAG = "<path fill=\"#E5E7EB\" fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M 346.13 103.28 C 347.01 103.28, 346.38 101.15, 349.89 103.90 C 353.39 106.66, 359.40 113.92, 363.66 117.05 C 367.91 120.18, 367.29 119.30, 371.17 119.55 C 375.05 119.80, 379.43 115.67, 383.06 118.30 C 386.69 120.93, 385.44 127.31, 389.32 132.69 C 393.20 138.08, 399.33 141.46, 402.46 145.21 C 405.59 148.97, 404.47 148.47, 404.97 151.47 C 405.47 154.48, 405.47 157.23, 404.97 160.23 C 404.47 163.24, 403.84 164.37, 402.46 166.49 C 401.09 168.62, 401.09 170.12, 398.08 170.88 C 395.08 171.63, 390.32 171.25, 387.44 170.25 C 384.56 169.25, 384.44 168.12, 383.69 165.87 C 382.94 163.61, 382.06 161.86, 383.69 158.98 C 385.31 156.10, 389.82 154.73, 391.82 151.47 C 393.83 148.22, 394.58 145.34, 393.70 142.71 C 392.83 140.08, 390.95 139.20, 387.44 138.33 C 383.94 137.45, 379.81 137.95, 376.18 138.33 C 372.55 138.70, 371.79 138.70, 369.29 140.21 C 366.79 141.71, 364.03 143.21, 363.66 145.84 C 363.28 148.47, 364.53 150.85, 367.41 153.35 C 370.29 155.85, 376.30 155.85, 378.05 158.36 C 379.81 160.86, 377.55 163.36, 376.18 165.87 C 374.80 168.37, 375.05 168.62, 371.17 170.88 C 367.29 173.13, 361.91 176.01, 356.77 177.13 C 351.64 178.26, 349.51 177.64, 345.51 176.51 C 341.50 175.38, 339.00 172.25, 336.74 171.50 C 334.49 170.75, 333.49 171.25, 334.24 172.75 C 334.99 174.26, 336.87 177.01, 340.50 179.01 C 344.13 181.02, 346.76 182.64, 352.39 182.77 C 358.02 182.89, 363.53 181.52, 368.67 179.64 C 373.80 177.76, 373.67 173.75, 378.05 173.38 C 382.44 173.00, 389.70 175.13, 390.57 177.76 C 391.45 180.39, 388.19 182.77, 382.44 186.52 C 376.68 190.28, 367.16 192.91, 361.78 196.54 C 356.40 200.17, 357.02 199.42, 355.52 204.67 C 354.02 209.93, 353.27 212.44, 354.27 222.83 C 355.27 233.22, 358.78 244.48, 360.53 256.63 C 362.28 268.77, 363.16 272.40, 363.03 283.54 C 362.91 294.68, 362.91 300.31, 359.90 312.33 C 356.90 324.35, 353.64 332.74, 348.01 343.63 C 342.38 354.52, 335.87 361.28, 331.74 366.79 C 327.60 372.30, 328.36 370.67, 327.35 371.17 C 326.35 371.67, 327.10 375.42, 326.73 369.29 C 326.35 363.16, 326.10 346.13, 325.48 340.50 C 324.85 334.87, 324.60 338.37, 323.60 341.12 C 322.60 343.88, 321.35 346.01, 320.47 354.27 C 319.59 362.53, 318.47 369.42, 319.22 382.44 C 319.97 395.45, 322.60 410.98, 324.22 419.36 C 325.85 427.75, 324.85 422.24, 327.35 424.37 C 329.86 426.50, 333.99 426.75, 336.74 430.00 C 339.50 433.26, 346.26 438.52, 341.12 440.65 C 335.99 442.77, 318.72 441.77, 311.08 440.65 C 303.44 439.52, 309.20 444.78, 302.94 435.01 C 296.68 425.25, 287.05 407.47, 279.78 391.82 C 272.52 376.18, 269.27 360.40, 266.64 356.77 C 264.01 353.14, 264.89 364.53, 266.64 373.67 C 268.39 382.81, 277.41 395.08, 275.40 402.46 C 273.40 409.85, 259.88 411.48, 256.63 410.60 C 253.37 409.73, 258.63 403.22, 259.13 398.08 C 259.63 392.95, 259.76 390.32, 259.13 384.94 C 258.50 379.56, 257.75 376.30, 256.00 371.17 C 254.25 366.04, 253.62 364.16, 250.37 359.28 C 247.11 354.39, 243.61 350.51, 239.73 346.76 C 235.85 343.00, 236.97 343.00, 230.96 340.50 C 224.95 338.00, 216.07 335.37, 209.68 334.24 C 203.30 333.11, 201.67 334.24, 199.04 334.87 C 196.41 335.49, 194.28 336.49, 196.54 337.37 C 198.79 338.25, 204.55 337.62, 210.31 339.25 C 216.07 340.87, 220.20 342.50, 225.33 345.51 C 230.46 348.51, 231.96 349.64, 235.97 354.27 C 239.98 358.90, 242.61 362.66, 245.36 368.67 C 248.11 374.67, 248.86 378.05, 249.74 384.31 C 250.62 390.57, 250.24 394.70, 249.74 399.96 C 249.24 405.22, 253.00 408.85, 247.24 410.60 C 241.48 412.35, 231.46 410.23, 220.95 408.72 C 210.43 407.22, 203.67 405.84, 194.66 403.09 C 185.65 400.34, 182.89 399.21, 175.88 394.95 C 168.87 390.70, 161.74 382.31, 159.61 381.81 C 157.48 381.31, 161.86 388.32, 165.24 392.45 C 168.62 396.58, 171.13 398.83, 176.51 402.46 C 181.89 406.09, 184.65 407.85, 192.16 410.60 C 199.67 413.36, 198.29 413.36, 214.06 416.23 C 229.84 419.11, 256.50 421.87, 271.02 425.00 C 285.54 428.13, 281.91 428.88, 286.67 431.88 C 291.43 434.89, 317.34 438.27, 294.81 440.02 C 272.27 441.77, 203.42 441.27, 174.00 440.65 C 144.59 440.02, 156.48 439.52, 147.72 436.89 C 138.95 434.26, 135.45 431.13, 130.19 427.50 C 124.93 423.87, 124.56 422.62, 121.43 418.74 C 118.30 414.86, 117.30 414.61, 114.54 408.10 C 111.79 401.59, 109.29 396.96, 107.66 386.19 C 106.03 375.42, 106.16 364.28, 106.41 354.27 C 106.66 344.25, 107.28 343.63, 108.91 336.12 C 110.54 328.61, 111.91 323.72, 114.54 316.71 C 117.17 309.70, 118.42 307.20, 122.05 301.07 C 125.68 294.93, 128.06 291.55, 132.69 286.04 C 137.33 280.54, 139.33 278.41, 145.21 273.53 C 151.10 268.64, 155.48 265.64, 162.11 261.63 C 168.75 257.63, 168.25 257.63, 178.39 253.50 C 188.53 249.37, 203.05 245.11, 212.81 240.98 C 222.58 236.85, 223.08 235.72, 227.21 232.84 C 231.34 229.96, 231.09 229.71, 233.47 226.58 C 235.85 223.45, 237.35 221.70, 239.10 217.19 C 240.85 212.69, 241.35 216.82, 242.23 204.05 C 243.11 191.28, 239.73 166.37, 243.48 153.35 C 247.24 140.33, 252.75 144.84, 261.01 138.95 C 269.27 133.07, 275.90 125.68, 284.79 123.93 C 293.68 122.18, 297.44 129.44, 305.45 130.19 C 313.46 130.94, 318.34 130.07, 324.85 127.69 C 331.36 125.31, 333.86 123.06, 338.00 118.30 C 342.13 113.54, 343.88 106.91, 345.51 103.90 C 347.13 100.90, 345.26 103.28, 346.13 103.28 Z M 364.91 70.73 C 367.41 71.23, 372.67 71.60, 376.80 73.86 C 380.93 76.11, 382.94 78.24, 385.56 82.00 C 388.19 85.75, 389.07 88.88, 389.95 92.64 C 390.82 96.39, 390.45 97.89, 389.95 100.77 C 389.45 103.65, 389.70 104.65, 387.44 107.03 C 385.19 109.41, 382.18 111.66, 378.68 112.67 C 375.17 113.67, 374.05 113.79, 369.92 112.04 C 365.79 110.29, 361.91 108.28, 358.02 103.90 C 354.14 99.52, 353.64 92.89, 350.51 90.13 C 347.38 87.38, 344.88 89.63, 342.38 90.13 C 339.87 90.63, 338.75 89.88, 338.00 92.64 C 337.24 95.39, 339.12 100.15, 338.62 103.90 C 338.12 107.66, 337.74 108.41, 335.49 111.41 C 333.24 114.42, 330.98 116.92, 327.35 118.92 C 323.72 120.93, 320.97 121.18, 317.34 121.43 C 313.71 121.68, 312.21 121.18, 309.20 120.18 C 306.20 119.17, 304.82 118.42, 302.32 116.42 C 299.81 114.42, 298.44 112.79, 296.68 110.16 C 294.93 107.53, 294.18 107.03, 293.56 103.28 C 292.93 99.52, 293.05 94.89, 293.56 91.38 C 294.06 87.88, 294.18 88.25, 296.06 85.75 C 297.94 83.25, 299.94 80.87, 302.94 78.87 C 305.95 76.86, 307.95 76.36, 311.08 75.74 C 314.21 75.11, 315.34 75.11, 318.59 75.74 C 321.85 76.36, 324.35 77.11, 327.35 78.87 C 330.36 80.62, 328.86 83.75, 333.61 84.50 C 338.37 85.25, 346.13 85.00, 351.14 82.62 C 356.15 80.24, 356.02 74.86, 358.65 72.61 C 361.28 70.35, 363.03 71.73, 364.28 71.35 C 365.54 70.98, 362.41 70.23, 364.91 70.73 Z M 355.52 348.64 C 354.64 355.90, 351.39 371.79, 350.51 385.56 C 349.64 399.33, 350.39 409.98, 351.14 417.49 C 351.89 425.00, 352.52 421.49, 354.27 423.12 C 356.02 424.75, 357.52 423.87, 359.90 425.62 C 362.28 427.38, 364.53 428.88, 366.16 431.88 C 367.79 434.89, 371.29 438.89, 368.04 440.65 C 364.78 442.40, 354.52 443.27, 349.89 440.65 C 345.26 438.02, 348.26 432.13, 344.88 427.50 C 341.50 422.87, 335.99 422.37, 332.99 417.49 C 329.98 412.60, 330.73 409.98, 329.86 403.09 C 328.98 396.21, 325.48 390.82, 328.61 383.06 C 331.74 375.30, 340.25 371.04, 345.51 364.28 C 350.76 357.52, 352.89 352.39, 354.89 349.26 C 356.90 346.13, 356.40 341.38, 355.52 348.64 Z M 287.92 87.63 C 286.54 90.01, 282.29 95.89, 280.41 100.15 C 278.53 104.40, 285.04 102.53, 278.53 108.91 C 272.02 115.29, 254.87 127.81, 247.86 132.07 C 240.85 136.32, 245.73 132.19, 243.48 130.19 C 241.23 128.19, 238.10 125.56, 236.60 122.05 C 235.09 118.55, 235.47 115.79, 235.97 112.67 C 236.47 109.54, 236.60 108.66, 239.10 106.41 C 241.60 104.15, 245.23 102.27, 248.49 101.40 C 251.74 100.52, 252.87 101.27, 255.37 102.02 C 257.88 102.78, 257.13 106.78, 261.01 105.15 C 264.89 103.53, 269.52 97.27, 274.78 93.89 C 280.04 90.51, 284.67 89.51, 287.30 88.25 C 289.92 87.00, 289.30 85.25, 287.92 87.63 Z M 318.59 82.00 C 316.46 82.12, 311.96 81.24, 308.58 82.62 C 305.20 84.00, 303.44 86.75, 301.69 88.88 C 299.94 91.01, 300.19 90.88, 299.81 93.26 C 299.44 95.64, 299.31 98.14, 299.81 100.77 C 300.31 103.40, 299.69 103.65, 302.32 106.41 C 304.95 109.16, 308.58 113.17, 312.96 114.54 C 317.34 115.92, 320.84 114.54, 324.22 113.29 C 327.60 112.04, 328.23 110.41, 329.86 108.28 C 331.49 106.16, 332.24 106.28, 332.36 102.65 C 332.49 99.02, 331.74 93.64, 330.48 90.13 C 329.23 86.63, 328.36 86.75, 326.10 85.12 C 323.85 83.50, 320.72 82.62, 319.22 82.00 C 317.72 81.37, 320.72 81.87, 318.59 82.00 Z M 369.29 76.36 C 368.16 76.36, 366.16 75.74, 364.28 76.36 C 362.41 76.99, 361.15 76.74, 359.90 79.49 C 358.65 82.25, 357.52 86.25, 358.02 90.13 C 358.53 94.01, 359.28 95.64, 362.41 98.89 C 365.54 102.15, 370.04 105.03, 373.67 106.41 C 377.30 107.78, 378.55 106.53, 380.56 105.78 C 382.56 105.03, 382.69 105.03, 383.69 102.65 C 384.69 100.27, 386.07 97.64, 385.56 93.89 C 385.06 90.13, 383.06 86.88, 381.18 83.87 C 379.31 80.87, 378.43 80.37, 376.18 78.87 C 373.92 77.36, 371.29 76.86, 369.92 76.36 C 368.54 75.86, 370.42 76.36, 369.29 76.36 Z M 327.98 132.69 C 326.73 132.94, 324.22 132.44, 322.35 133.95 C 320.47 135.45, 319.09 137.95, 318.59 140.21 C 318.09 142.46, 318.72 143.46, 319.84 145.21 C 320.97 146.97, 322.22 148.22, 324.22 148.97 C 326.23 149.72, 327.60 150.09, 329.86 148.97 C 332.11 147.84, 334.62 145.96, 335.49 143.33 C 336.37 140.71, 335.62 137.95, 334.24 135.82 C 332.86 133.70, 329.86 133.32, 328.61 132.69 C 327.35 132.07, 329.23 132.44, 327.98 132.69 Z\"/>";
const DEFAULT_FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512"><rect width="512" height="512" rx="104" fill="#BE3609"/>${CODEOTTER_PATH_TAG}</svg>`;

// Settings are schema-driven: each page is { title, load() -> { sections, values }, save(body), test?() }.
// The server describes sections and fields as JSON; the UI has one generic renderer and a sidebar link per page.
// Field types: select, combo (select + free text), text, password, number, range, checkbox, readonly.
const mask = (secret) => (secret ? `\u2022\u2022\u2022\u2022${secret.slice(-4)}` : "");
const byProvider = (pick) => Object.fromEntries(Object.entries(PROVIDERS).map(([k, x]) => [k, pick(x)]));
const LOGIN_PROVIDERS = { github: { label: "GitHub", pb: "github" }, ...FORGES };
const oauthFlows = new Map();
const FORGE_CONNECTIONS = Object.fromEntries(Object.entries(FORGES).map(([id, f]) => [id, {
    async load() {
      return { sections: [{ id, title: `${f.label} connection`, fields: [
        { key: "url", label: "Server URL", type: "text", placeholder: `https://${id}.example.com` },
        { key: "token", label: "Access token", type: "password", placeholder: mask(f.token), hint: "Leave blank to keep the stored token." },
      ], actions: [{ id: "save", label: "Save" }, { id: `test${id}`, label: "Test connection", variant: "outline", needsSaved: true }] }], values: { [id]: { url: f.url, token: "" } } };
    },
    async save(body) {
      const v = body[id];
      if (!v) return;
      const nextUrl = forgeOrigin(v.url);
      if (nextUrl && Object.entries(FORGES).some(([other, value]) => other !== id && value.url === nextUrl)) throw new Error("Each provider must use a separate server origin");
      if (nextUrl !== f.url) {
        const linked = (await repos()).some((r) => forgeId(r) === id) || (await store.all()).some((r) => forgeId(repoOf(r.pr)) === id);
        const oauth = PB_URL && ((await store.getOAuth()).providers.some((p) => p.name === f.pb) || await store.hasForgeIdentities(f.pb));
        if (linked || oauth) throw new Error(`Cannot change the ${f.label} server while repositories, reviews, or OAuth identities are linked`);
      }
      const token = nextUrl ? String(v.token || (nextUrl === f.url ? f.token : "")) : "";
      await store.setSetting(id, { url: nextUrl, token });
      await store.setSetting(`${id}Origin`, nextUrl);
      f.url = nextUrl;
      f.token = token;
      guideCache.clear();
    },
    async test() {
      const rows = await forgeApi("user/repos?limit=1", { source: id });
      if (!Array.isArray(rows)) throw new Error("Invalid git server response");
      return { ok: true, reply: `Connected to ${f.label}` };
    },
  }]));
const SETTINGS_PAGES = {
  repos: {
    title: "Repositories",
    group: "settings",
    access: "admin",
    // Scoped to the active organization: only its repositories are listed, offered, or touched on save.
    async load({ org } = {}) {
      const list = (await repos()).filter((r) => !org || r.startsWith(`${org}/`));
      const [guides, repoSettings, rc] = await Promise.all([
        store.getSetting("guides").then((x) => x || {}),
        store.getSetting("repoSettings").then((x) => x || {}),
        reviewConfig(),
      ]);
      const items = await Promise.all(list.map(async (r) => {
        const files = await guideFiles(r);
        const label = files.join(" + ");
        const g = guides[r] || {};
        const rs = repoSettings[r] || {};
        const postScores = g.postScores ?? rc.postScores;
        const postReview = g.postReview ?? rc.postReview;
        const postInlineSuggestions = g.postInlineSuggestions ?? rs.postInlineSuggestions ?? rc.postInlineSuggestions;
        const learnings = normalizeLearningList(rs.learnings ?? g.learnings ?? []);
        const accepted = normalizeLearningList(rs.accepted ?? []);
        const settings = {
          title: r,
          fields: [
            files.length ? { key: "useGuides", label: "Auto-detected", type: "checkbox", text: label } : { key: "none", label: "Auto-detected", type: "readonly" },
            { key: "postScores", label: "Post scores on PR", type: "checkbox", text: "Add a comment to the PR with all System One scores" },
            { key: "postReview", label: "Add PR review as a comment", type: "checkbox", text: "Add the review summary and a link to the full report" },
            { key: "postInlineSuggestions", label: "Post inline suggestions", type: "checkbox", text: "Post inline committable suggestion comments on PR diff lines" },
            { key: "learnings", label: "Team learnings", type: "list", removable: true, hint: "Dismissed review findings remembered as persistent team rules for this repository." },
            { key: "accepted", label: "Accepted fixes", type: "list", removable: true },
          ],
          values: {
            ...(files.length ? { useGuides: g.use ?? true } : { none: "none" }),
            postScores: !!postScores,
            postReview: !!postReview,
            postInlineSuggestions: !!postInlineSuggestions,
            learnings,
            accepted,
          },
        };
        const meta = [
          files.length ? label : "",
          postScores ? "Post scores" : "",
          postReview ? "Post review" : "",
          postInlineSuggestions ? "Inline suggestions" : "",
          learnings.length ? `${learnings.length} learning${learnings.length === 1 ? "" : "s"}` : "",
          accepted.length ? `${accepted.length} accepted fix${accepted.length === 1 ? "" : "es"}` : "",
        ]
          .filter(Boolean)
          .join(" · ");
        return { id: r, label: repoLabel(r), meta: meta || undefined, settings };
      }));
      const sections = [
        {
          id: "repos",
          title: "Onboarded repositories",
          description: "Pull requests from these repositories show up in Reviews and in the sidebar.",
          fields: [
            { key: "list", label: "Repositories", type: "list", hint: "The gear opens a repository's settings; the cross removes it (reviews already stored are kept)." },
            { key: "add", label: "Add repository", type: "combo", placeholder: "owner/name or repository URL", options: (await repositoryChoices(org)).filter((r) => !list.includes(r)).map((value) => ({ value, label: repoLabel(value) })) },
          ],
          actions: [{ id: "save", label: "Save" }],
        },
      ];
      return { sections, values: { repos: { list: items, add: "" } } };
    },
    async save(body, { org } = {}) {
      const v = body.repos;
      if (!v) return;
      const clean = (r) => cleanRepo(r, org);
      const add = clean(v.add || "");
      const listed = (v.list || []).map((it) => (typeof it === "string" ? { id: it } : it));
      const mine = [...new Set([...listed.map((it) => clean(it.id)), add].filter(Boolean))];
      for (const r of mine) if (!REPO_RE.test(r)) throw new Error(`Not an owner/name: ${r}`);
      if (org) for (const r of listed.map((it) => clean(it.id))) if (!r.startsWith(`${org}/`)) throw new Error(`${r} is not under ${org}`);
      // other organizations' repositories are untouched by a scoped save
      const others = org ? (await repos()).filter((r) => !r.startsWith(`${org}/`)) : [];
      const next = [...others, ...mine];
      if (add && !(v.list || []).map(clean).includes(add)) {
        try {
          if (isForgeRepo(add)) await forgeApi(`repos/${add}`);
          else gh("repo", "view", add, "--json", "nameWithOwner");
        } catch {
          throw new Error(`Cannot access ${nativeRepo(add)}: check the name and ${isForgeRepo(add) ? FORGES[forgeId(add)].label : "GitHub"} credentials`);
        }
      }
      await store.setSetting("repos", next);
      const [guides, repoSettings] = await Promise.all([
        store.getSetting("guides").then((x) => ({ ...(x || {}) })),
        store.getSetting("repoSettings").then((x) => ({ ...(x || {}) })),
      ]);
      for (const it of listed) {
        const sv = it.settings?.values;
        if (!sv) continue;
        const id = clean(it.id);
        const nextLearnings = "learnings" in sv ? normalizeLearningList(sv.learnings) : undefined;
        const nextAccepted = "accepted" in sv ? normalizeLearningList(sv.accepted) : undefined;
        guides[id] = {
          ...(guides[id] || {}),
          ...("useGuides" in sv ? { use: !!sv.useGuides } : {}),
          ...("postScores" in sv ? { postScores: !!sv.postScores } : {}),
          ...("postReview" in sv ? { postReview: !!sv.postReview } : {}),
          ...("postInlineSuggestions" in sv ? { postInlineSuggestions: !!sv.postInlineSuggestions } : {}),
          ...(nextLearnings !== undefined ? { learnings: nextLearnings } : {}),
        };
        repoSettings[id] = {
          ...(repoSettings[id] || {}),
          ...("postInlineSuggestions" in sv ? { postInlineSuggestions: !!sv.postInlineSuggestions } : {}),
          ...(nextLearnings !== undefined ? { learnings: nextLearnings } : {}),
          ...(nextAccepted !== undefined ? { accepted: nextAccepted } : {}),
        };
      }
      for (const k of Object.keys(guides)) if (!next.includes(k)) delete guides[k];
      for (const k of Object.keys(repoSettings)) if (!next.includes(k)) delete repoSettings[k];
      await Promise.all([store.setSetting("guides", guides), store.setSetting("repoSettings", repoSettings)]);
    },
  },
  model: {
    title: "Model provider",
    group: "admin",
    access: "admin",
    async load() {
      const c = await llmConfig();
      const s1 = await s1Config();
      const r = await reviewConfig();
      const p = PROVIDERS[c.provider] || PROVIDERS.custom;
      const localIds = Object.keys(LOCAL);
      const llmCanList = !c.local && c.baseUrl && (c.apiKey || p.noKey || c.provider === "openrouter" || /localhost|127\.0\.0\.1/.test(c.baseUrl));
      const [llmLive, s1Live] = await Promise.all([
        llmCanList ? listModels(p.api === "anthropic" ? "anthropic" : "openai", c) : [],
        s1.provider === "jev" && s1.apiKey ? listModels("s1-typesafe", s1) : s1.provider === "jev_openrouter" ? listModels("s1-openrouter", s1) : [],
      ]);
      const sections = [
        {
          id: "llm",
          title: "Language model",
          description: "Writes the walkthrough and findings. Also scores when no System One model is configured.",
          fields: [
            { key: "provider", label: "Provider", type: "select", options: Object.entries(PROVIDERS).map(([value, x]) => ({ value, label: x.label, icon: providerIcon(value) })) },
            { key: "model", label: "Model", type: "select", hint: llmLive.length ? `${llmLive.length} models listed by ${p.label}.` : c.provider === "custom" ? "Type the model id your endpoint serves." : "Save a key to list the provider's models.", optionsBy: { field: "provider", map: { ...Object.fromEntries(Object.entries(PROVIDERS).map(([k, x]) => [k, x.models.map((value) => ({ value, label: value, icon: modelIcon(value, k) }))])), ...(llmLive.length ? { [c.provider]: llmLive } : {}) } } },
            { key: "apiKey", label: "API key", type: "password", hint: c.apiKey ? `Saved key ${mask(c.apiKey)}. Leave blank to keep it.` : p.noKey ? "" : "No key saved yet.", placeholder: mask(c.apiKey) || "paste key", hideWhen: { field: "provider", in: Object.keys(PROVIDERS).filter((k) => PROVIDERS[k].noKey) }, linkBy: { field: "provider", map: Object.fromEntries(Object.entries(PROVIDERS).filter(([, x]) => x.keyUrl).map(([k, x]) => [k, { label: "Get a key", url: x.keyUrl }])) } },
            { key: "baseUrl", label: "Base URL", type: "text", hint: "Prefilled per provider. Change only for proxies or self-hosted gateways.", hideWhen: { field: "provider", in: Object.keys(PROVIDERS).filter((k) => PROVIDERS[k].local) }, defaultBy: { field: "provider", map: byProvider((x) => x.baseUrl) } },
            { key: "llmStatus", label: "Status", type: "readonly", hideWhen: { field: "provider", in: Object.keys(PROVIDERS).filter((k) => !PROVIDERS[k].local) }, hint: c.local ? "Download, switch or delete local models under Settings / Local models." : "" },
          ],
          actions: [{ id: "save", label: "Save" }, { id: "test", label: "Test connection", variant: "outline", needsSaved: true }],
        },
        {
          id: "s1",
          title: "System One model",
          description: "Typed scores and merge gates in one fast pass. Owns scoring when configured; runs alongside the language model.",
          fields: [
            { key: "provider", label: "Provider", type: "select", options: [{ value: "none", label: "None" }, ...Object.entries(S1_PROVIDERS).map(([value, x]) => ({ value, label: x.label, icon: providerIcon(value) }))], infoBy: { field: "provider", map: Object.fromEntries(LOCAL_S1.filter(contextNote).map((m) => [m.id, contextNote(m)])) } },
            { key: "model", label: "Model", type: "select", hideWhen: { field: "provider", in: ["none", ...localIds] }, hint: s1Live.length ? `${s1Live.length} models listed by ${S1_PROVIDERS[s1.provider].label}.` : "", optionsBy: { field: "provider", map: { none: [], ...Object.fromEntries(Object.entries(S1_PROVIDERS).map(([k, x]) => [k, x.models.map((value) => ({ value, label: value, icon: modelIcon(value, k) }))])), ...(s1Live.length ? { [s1.provider]: s1Live } : {}) } } },
            { key: "apiKey", label: "API key", type: "password", hideWhen: { field: "provider", in: ["none", ...localIds] }, hint: s1.apiKey ? `Saved key ${mask(s1.apiKey)}. Leave blank to keep it.` : s1.provider === "custom" ? "Optional." : "No key saved yet.", placeholder: mask(s1.apiKey) || "paste key", linkBy: { field: "provider", map: Object.fromEntries(Object.entries(S1_PROVIDERS).filter(([, x]) => x.keyUrl).map(([k, x]) => [k, { label: "Get a key", url: x.keyUrl }])) } },
            { key: "baseUrl", label: "Base URL", type: "text", hideWhen: { field: "provider", in: ["none", ...localIds] }, placeholder: "http://host:port", defaultBy: { field: "provider", map: { none: "", ...Object.fromEntries(Object.entries(S1_PROVIDERS).map(([k, x]) => [k, x.baseUrl])) } } },
            { key: "status", label: "Status", type: "readonly", hideWhen: { field: "provider", in: ["none", "jev", "jev_openrouter", "custom"] }, hint: s1.local ? "Download, switch or delete local models under Settings / Local models." : "" },
          ],
          actions: [{ id: "save", label: "Save" }, { id: "probe", label: "Test connection", variant: "outline", needsSaved: true }],
        },
        {
          id: "triage",
          title: "Fast triage",
          description: "System One rates correctness risk and blast radius of each pull request and sets the codeotter/triage commit status.",
          fields: [
            { key: "auto", label: "Automatic", type: "checkbox", text: "Triage new and updated pull requests in onboarded repositories" },
            { key: "stopAt", label: "Fail status at risk", type: "range", min: 25, max: 100, step: 25, hint: "codeotter/triage fails at or above this correctness risk." },
          ],
          actions: [{ id: "save", label: "Save" }],
        },
        {
          id: "review",
          title: "Review",
          description: "How much the model reads, how many findings it returns, and what gets posted as PR comments.",
          fields: [
            { key: "maxFindings", label: "Max findings", type: "range", min: 3, max: 12, step: 1 },
            { key: "diffChars", label: "Diff sent to the model", type: "select", options: [30000, 60000, 90000, 150000, 300000].map((v) => ({ value: v, label: `${v / 1000}k characters` })), hint: "Larger diffs cost more and may exceed the model's context." },
            { key: "contextLines", label: "Context above a change", type: "select", options: [0, 8, 16, 32].map((v) => ({ value: v, label: v ? `Up to ${v} lines, to the enclosing declaration` : "Off: git's 3 lines" })) },
            { key: "reflectMin", label: "Self-check", type: "select", options: [0, 3, 5, 7].map((v) => ({ value: v, label: v ? `Second pass drops findings scored below ${v}/10` : "Off" })) },
            { key: "temperature", label: "Temperature", type: "range", min: 0, max: 1, step: 0.1, hint: "Ignored by Anthropic models, which do not take sampling parameters." },
            { key: "postScores", label: "Post scores on PR", type: "checkbox", text: "Add a PR comment with all System One scores after review" },
            { key: "postReview", label: "Add PR review as a comment", type: "checkbox", text: "Add a PR comment with the review summary and link to the full report" },
            { key: "postInlineSuggestions", label: "Post inline suggestions", type: "checkbox", text: "Post inline committable suggestion comments on PR diff lines" },
            { key: "commands", label: "PR comment commands", type: "checkbox", text: "Run /review, /describe, /improve, /ask, /docs and /changelog from comments by owners, members and collaborators" },
          ],
          actions: [{ id: "save", label: "Save" }],
        },
      ];
      return { sections, values: { llm: { provider: c.provider, model: c.model, apiKey: "", baseUrl: c.baseUrl, llmStatus: c.local ? localStatus(c.local).text : "" }, s1: { provider: s1.provider, model: s1.model, apiKey: "", baseUrl: s1.baseUrl, status: s1.local ? localStatus(s1.local).text : "" }, review: r, triage: await triageConfig() } };
    },
    async save(body) {
      if (body.triage) {
        const v = body.triage;
        await store.setSetting("triage", { auto: !!v.auto, stopAt: Math.min(100, Math.max(25, Math.round((Number(v.stopAt) || 75) / 25) * 25)) });
      }
      if (body.llm) {
        const v = body.llm;
        if (!PROVIDERS[v.provider]) throw new Error(`Unknown provider ${v.provider}`);
        const prev = (await store.getSetting("llm")) || {};
        const apiKey = v.apiKey || (prev.provider === v.provider && (v.baseUrl || "") === (prev.baseUrl || "") ? prev.apiKey : "") || "";
        await store.setSetting("llm", PROVIDERS[v.provider].local ? { provider: v.provider } : { provider: v.provider, model: v.model || "", baseUrl: v.baseUrl || "", apiKey });
        if (PROVIDERS[v.provider].local && sidecars.llm.id && sidecars.llm.id !== PROVIDERS[v.provider].local.id) stopSidecar("llm");
        modelCache.clear();
      }
      if (body.s1) {
        const v = body.s1;
        if (v.provider !== "none" && !S1_PROVIDERS[v.provider]) throw new Error(`Unknown System One provider ${v.provider}`);
        if (v.provider === "custom" && !/^https?:\/\//.test(v.baseUrl || "")) throw new Error("Custom endpoint needs a base URL");
        const prev = (await store.getSetting("s1")) || {};
        const apiKey = v.apiKey || (prev.provider === v.provider && (v.baseUrl || "") === (prev.baseUrl || "") ? prev.apiKey : "") || "";
        await store.setSetting("s1", v.provider === "none" ? { provider: "none" } : S1_PROVIDERS[v.provider].local ? { provider: v.provider } : { provider: v.provider, model: v.model || "", baseUrl: v.baseUrl || "", apiKey });
        if (S1_PROVIDERS[v.provider]?.local && sidecars.s1.id && sidecars.s1.id !== v.provider) stopSidecar("s1");
        modelCache.clear();
      }
      if (body.review) {
        const v = body.review;
        const nextReview = {
          maxFindings: Math.min(12, Math.max(3, Number(v.maxFindings) || 8)),
          diffChars: Number(v.diffChars) || 90000,
          reflectMin: [0, 3, 5, 7].includes(Number(v.reflectMin)) ? Number(v.reflectMin) : REVIEW_DEFAULTS.reflectMin,
          contextLines: [0, 8, 16, 32].includes(Number(v.contextLines)) ? Number(v.contextLines) : REVIEW_DEFAULTS.contextLines,
          temperature: Math.min(1, Math.max(0, Number(v.temperature) || 0)),
          postScores: !!v.postScores,
          postReview: !!v.postReview,
          postInlineSuggestions: !!v.postInlineSuggestions,
          commands: !!v.commands,
        };
        await store.setSetting("review", nextReview);
        const guides = (await store.getSetting("guides")) || {};
        for (const k of Object.keys(guides)) {
          guides[k] = { ...guides[k], postScores: nextReview.postScores, postReview: nextReview.postReview, postInlineSuggestions: nextReview.postInlineSuggestions };
        }
        await store.setSetting("guides", guides);
      }
    },
    actions: {
      async probe() {
        const t = Date.now();
        const a = await askSystemOne({ document: "The function returns the sum of two integers." }, { ok: { type: "noul", instructions: "The document describes an addition." } }, await s1Config());
        const yes = Number(a.ok?.noul) || 0;
        return { message: `Connected, answered in ${Date.now() - t} ms (${Math.round(yes * 100)}% yes).` };
      },
    },
    async test() {
      const t = Date.now();
      const reply = await askModel("Reply with the single word OK.", await llmConfig());
      return { ok: /ok/i.test(reply), reply: reply.trim().slice(0, 200), ms: Date.now() - t };
    },
  },
  oauth: {
    title: "OAuth",
    group: "admin",
    access: "admin",
    async load() {
      const connections = await Promise.all(Object.values(FORGE_CONNECTIONS).map((connection) => connection.load()));
      if (!PB_URL) return { sections: [{ id: "oauth", title: "OAuth", description: "Sign-in requires PocketBase (PB_URL).", fields: [] }, ...connections.flatMap((c) => c.sections)], values: Object.assign({}, ...connections.map((c) => c.values)) };
      const o = await store.getOAuth();
      const values = {};
      const sections = Object.entries(LOGIN_PROVIDERS).map(([id, spec]) => {
        const current = o.providers.find((p) => p.name === spec.pb) || {};
        const section = id === "github" ? "oauth" : `${id}oauth`;
        values[section] = { enabled: !!o.enabled && !!current.clientId, clientId: current.clientId || "", clientSecret: "", redirectUrl: `${APP_URL}/auth/callback` };
        return {
          id: section, title: `${spec.label} OAuth`,
          fields: [
            { key: "enabled", label: "Enabled", type: "checkbox", hint: "Disabling removes this provider's saved credentials." },
            { key: "clientId", label: "Client ID", type: "text", ...(id === "github" || FORGES[id].url ? { link: { label: "Create OAuth app", url: id === "github" ? "https://github.com/settings/developers" : `${FORGES[id].url}/user/settings/applications` } } : {}) },
            { key: "clientSecret", label: "Client secret", type: "password", placeholder: current.clientId ? "Saved" : "", hint: "Leave blank to keep the stored secret." },
            { key: "redirectUrl", label: "Callback URL", type: "readonly" },
          ],
          actions: [{ id: "save", label: "Save" }, ...(id === "github" && !current.clientId ? [{ id: "connect", label: "Create GitHub app for me", variant: "outline", always: true }] : [])],
        };
      });
      return { sections: sections.flatMap((section, i) => i === 0 ? [section] : [...connections[i - 1].sections, section]), values: Object.assign(values, ...connections.map((c) => c.values)) };
    },
    // GitHub App manifest flow: the browser posts a manifest to GitHub, the user clicks Create once, GitHub returns a
    // code to /github/manifest/callback, and the conversion gives us the client id + secret to store in PocketBase.
    actions: {
      ...Object.fromEntries(Object.entries(FORGE_CONNECTIONS).map(([id, connection]) => [`test${id}`, async () => ({ message: (await connection.test()).reply })])),
      async connect(req, res, body) {
        if (!PB_URL) throw new Error("Sign-in is not available in file-storage mode (set PB_URL)");
        const state = randomBytes(16).toString("hex");
        setCookie(res, "pr_manifest", state, 600);
        if (body?.returnTo) {
          setCookie(res, "pr_manifest_return", body.returnTo, 600);
        }
        const owner = ((await repos())[0] || "codeotter").split("/")[0].toLowerCase().replace(/[^a-z0-9-]/g, "-");
        const appPrefix = owner && owner !== "pr-scorer" && owner !== "codeotter" ? `codeotter-${owner}` : "codeotter";
        const manifest = {
          name: `${appPrefix}`.slice(0, 28) + "-" + Math.random().toString(36).slice(2, 6),
          url: APP_URL,
          redirect_url: `${APP_URL}/github/manifest/callback`,
          callback_urls: [`${APP_URL}/auth/callback`],
          setup_url: `${APP_URL}/onboarding?step=2&connected=github`,
          public: false,
          default_permissions: {
            emails: "read",
            contents: "read",
            pull_requests: "write",
            statuses: "write",
            issues: "write",
            metadata: "read",
            administration: "read",
          },
          request_oauth_on_install: true,
        };
        return { submit: { url: `https://github.com/settings/apps/new?state=${state}`, fields: { manifest: JSON.stringify(manifest) } } };
      },
    },
    async save(body) {
      for (const connection of Object.values(FORGE_CONNECTIONS)) await connection.save(body);
      if (!Object.keys(LOGIN_PROVIDERS).some((id) => body[id === "github" ? "oauth" : `${id}oauth`])) return;
      if (!PB_URL) throw new Error("Sign-in requires PocketBase (PB_URL)");
      const o = await store.getOAuth();
      let providers = [...o.providers];
      for (const [id, spec] of Object.entries(LOGIN_PROVIDERS)) {
        const v = body[id === "github" ? "oauth" : `${id}oauth`];
        if (!v) continue;
        const current = providers.find((p) => p.name === spec.pb);
        providers = providers.filter((p) => p.name !== spec.pb);
        if (!v.enabled) continue;
        const clientId = String(v.clientId || "").trim();
        if (!clientId) throw new Error(`${spec.label} client ID is required`);
        if (!current && !v.clientSecret) throw new Error(`${spec.label} client secret is required`);
        if (id !== "github" && !FORGES[id].url) throw new Error(`Configure the server in Admin / OAuth / ${spec.label} connection first`);
        providers.push({ ...current, name: spec.pb, clientId,
          ...(v.clientSecret ? { clientSecret: String(v.clientSecret) } : {}),
          ...(id !== "github" ? { displayName: spec.label, pkce: true,
            authURL: `${FORGES[id].url}/login/oauth/authorize`, tokenURL: `${FORGES[id].url}/login/oauth/access_token`, userInfoURL: id === "gitea" ? `${FORGES[id].url}/api/v1/user` : `${FORGES[id].url}/login/oauth/userinfo`,
          } : {}),
        });
      }
      await store.setOAuth({ ...o, enabled: providers.length > 0, providers });
    },
  },
};
SETTINGS_PAGES.accounts = {
  title: "Accounts",
  group: "admin",
  access: "owner",
  async load(_scope, user) {
    if (!PB_URL) return { sections: [{ id: "accounts", title: "Accounts", description: "Accounts are not available in file-storage mode (set PB_URL).", fields: [] }], values: {} };
    const items = (await store.users()).map((u) => ({
      id: u.id,
      label: (u.name || u.email || u.id) + (user && u.id === user.id ? " (you)" : ""),
      meta: `${u.role || "no role"} · ${u.email || ""}`,
      settings: { title: u.name || u.email || u.id, fields: [{ key: "role", label: "Role", type: "select", options: ROLES.map((value) => ({ value, label: value })) }], values: { role: u.role || "admin" } },
    }));
    return { sections: [{ id: "accounts", title: "Accounts", fields: [{ key: "list", label: "Accounts", type: "list", removable: false, hint: "Gear sets the role. OAuth sign-in creates accounts; the first one is the owner." }], actions: [{ id: "save", label: "Save" }] }], values: { accounts: { list: items } } };
  },
  async save(body) {
    const v = body.accounts;
    if (!v) return;
    const listed = (v.list || []).map((it) => (typeof it === "string" ? { id: it } : it));
    const users = await store.users();
    const next = new Map(users.map((u) => [u.id, u.role]));
    for (const it of listed) if (it.settings?.values?.role) next.set(it.id, it.settings.values.role);
    for (const u of users) if (!listed.some((it) => it.id === u.id)) throw new Error("Removing accounts is not supported yet; change the role instead");
    if (![...next.values()].includes("owner")) throw new Error("At least one owner is required");
    for (const [id, role] of next) if (role !== users.find((u) => u.id === id)?.role) await store.setRole(id, role);
  },
};
// Local models page: what is downloaded, what is available, one action per row. Nothing downloads by itself.
SETTINGS_PAGES.models = {
  title: "Local models",
  group: "admin",
  access: "admin",
  async load() {
    const s1 = await s1Config();
    const llm = await llmConfig();
    const row = (m) => {
      const st = localStatus(m);
      const d = downloads.get(m.id);
      const active = m.kind === "s1" ? s1.provider === m.id : llm.provider === `local_${m.id}`;
      const facts = [m.maker, `${m.sizeMB} MB`, m.license, `${m.contextTokens}-token context`, m.notes].join(" · ");
      return {
        id: m.id,
        label: m.label.replace(" (local)", ""),
        icon: m.icon || modelIcon(m.repo || m.modelId, m.id),
        badge: active ? "Active" : st.state === "ready" ? "Downloaded" : undefined,
        info: contextNote(m) || undefined,
        meta: st.state === "ready" || st.state === "missing" ? facts : `${facts} · ${st.text}`,
        progress: st.state === "downloading" && d?.total ? Math.round((d.done / d.total) * 100) : undefined,
        actions: st.state === "ready" ? [...(active ? [] : [{ id: "use", label: "Use" }]), { id: "delete", label: "Delete", variant: "outline" }] : st.state === "downloading" ? [] : [{ id: "download", label: `Download ${m.sizeMB} MB` }],
        state: st.state,
      };
    };
    const llmRows = LOCAL_LLM.map(row);
    const s1Rows = LOCAL_S1.map(row);
    const runtime = Object.keys(RUNTIMES).map((name) => {
      const sc = Object.values(sidecars).find((x) => x.proc && x.ready && LOCAL[x.id]?.runtime === name);
      const assets = runtimeAssets(name);
      const running = sc ? ` · running ${LOCAL[sc.id].label} on ${sc.device}` : "";
      if (RUNTIMES[name].kind === "python") return existsSync(venvPython(name)) ? `${name} (Python venv) installed${running}` : findPython() ? `${name}: Python venv created with the first download` : `${name}: needs Python 3.10+ on PATH`;
      return existsSync(runtimeBin(name)) ? `${name} ${RUNTIMES[name].version} installed${running}` : assets.length ? `${name} ${RUNTIMES[name].version} fetched with the first download` : `${name}: no build for ${process.platform}-${process.arch}`;
    }).join(" · ");
    const poll = (rows) => (rows.some((r) => r.state === "downloading") ? 2000 : 0);
    // Same two engines as Model provider: both are used together. Download / Use / Delete per row; nothing downloads by itself.
    const sections = [
      {
        id: "llm",
        title: "Language models",
        description: "Writes the summary, walkthrough and findings. Use makes one the active language model.",
        fields: [{ key: "list", label: "Models", type: "list", removable: false }],
        poll: poll(llmRows),
      },
      {
        id: "s1",
        title: "System One models",
        description: "Answers scores and gates. Use makes one the active System One model.",
        fields: [{ key: "list", label: "Models", type: "list", removable: false }],
        poll: poll(s1Rows),
      },
      {
        id: "runtime",
        title: "Runtimes",
        fields: [{ key: "runtime", label: "Runtime", type: "readonly", hint: `Data directory ${DATA_DIR}` }],
      },
    ];
    return { sections, values: { llm: { list: llmRows }, s1: { list: s1Rows }, runtime: { runtime } } };
  },
  async save() {},
  actions: {
    async download(_req, _res, body) {
      const m = LOCAL[body?.item];
      if (!m) throw new Error("Unknown model");
      const haveModel = modelReady(m);
      if (!haveModel && !downloads.get(m.id)?.active) downloadModel(m);
      ensureRuntime(m.runtime).catch(() => {});
      return { message: haveModel ? `Installing the ${m.runtime} runtime…` : `Downloading ${m.label} (${m.sizeMB} MB)…` };
    },
    async use(_req, _res, body) {
      const m = LOCAL[body?.item];
      if (!m) throw new Error("Unknown model");
      if (!modelReady(m)) throw new Error(`${m.label} is not downloaded`);
      if (sidecars[m.kind].id && sidecars[m.kind].id !== m.id) stopSidecar(m.kind);
      if (m.kind === "s1") await store.setSetting("s1", { provider: m.id });
      else await store.setSetting("llm", { provider: `local_${m.id}` });
      modelCache.clear();
      return { message: `${m.label} is now the ${m.kind === "s1" ? "System One" : "language"} model.` };
    },
    async delete(_req, _res, body) {
      const m = LOCAL[body?.item];
      if (!m) throw new Error("Unknown model");
      if (sidecars[m.kind].id === m.id) stopSidecar(m.kind);
      rmSync(modelPath(m), { force: true, recursive: true });
      rmSync(`${modelPath(m)}.part`, { force: true });
      downloads.delete(m.id);
      if (m.kind === "s1") { const s1 = (await store.getSetting("s1")) || {}; if (s1.provider === m.id) await store.setSetting("s1", { provider: "none" }); }
      else { const l = (await store.getSetting("llm")) || {}; if (l.provider === `local_${m.id}`) await store.setSetting("llm", { provider: "minimax" }); }
      return { message: `${m.label} deleted.` };
    },
  },
};

const settingsPages = async (user) => {
  const role = await effectiveRole(user);
  // group "settings" = organization-scoped pages; group "admin" = platform-wide pages, shown to admins and owners in every organization
  return Object.entries(SETTINGS_PAGES).filter(([, p]) => allowed(role, p.access)).map(([id, p]) => ({ id, title: p.title, group: p.group || "settings" }));
};

// Home dashboard: sections of kind "stats", "table" or "links", drawn by the UI's generic report renderer.
const avg = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
const VERDICT_CELL = { approve: { text: "Approved", tone: "ok" }, comment: { text: "Commented", tone: "warn" }, request_changes: { text: "Changes requested", tone: "bad" } };
async function homeData(org = "") {
  const rs = (await repos()).filter((r) => !org || r.startsWith(`${org}/`));
  const all = (await store.all()).filter((r) => !org || rs.includes(repoOf(r.pr)));
  const done = new Set(all.map((r) => r.pr.url));
  const open = (await Promise.all(rs.map(openPrs))).flat();
  const waiting = open.filter((p) => !done.has(p.url));
  const c = await llmConfig();
  const week = all.filter((r) => Date.now() - Date.parse(r.at) < 7 * 864e5);
  const changes = all.filter((r) => r.review.verdict === "request_changes").length;
  const perRepo = (repo) => {
    const mine = all.filter((r) => repoOf(r.pr) === repo);
    const wait = waiting.filter((p) => repoOf(p) === repo).length;
    return [
      { text: repoLabel(repo), path: `/repo/${repo}` },
      wait ? { text: `${wait} waiting`, tone: "warn" } : { text: "none waiting", tone: "muted" },
      mine.length,
      mine.length ? avg(mine.map((r) => r.review.scores.quality)) : "",
      mine.length ? avg(mine.map((r) => r.blast.score)) : "",
      { text: "Open pull requests", path: `/repo/${repo}/open` },
    ];
  };
  const sections = [
    { id: "stats", kind: "stats", items: [
      { label: "Waiting for review", value: waiting.length, unit: waiting.length === 1 ? "pull request" : "pull requests", hint: `Across ${rs.length} ${rs.length === 1 ? "repository" : "repositories"}`, action: rs[0] ? { label: "Open pull requests", path: `/repo/${rs[0]}/open` } : { label: "Add a repository", path: "/settings/repos" } },
      { label: "Reviewed", value: all.length, unit: all.length === 1 ? "review" : "reviews", hint: `${week.length} in the last 7 days` },
      { label: "Average quality", value: all.length ? avg(all.map((r) => r.review.scores.quality)) : "–", unit: all.length ? "/ 100" : "", hint: all.length ? `${changes} with changes requested` : "No reviews yet" },
    ] },
    { id: "repos", kind: "table", title: "Repositories", columns: ["Repository", "Waiting", "Reviewed", "Avg quality", "Avg blast", ""], rows: rs.map(perRepo), empty: "No repository yet. Use \"Add repository\" in the sidebar." },
    { id: "recent", kind: "table", title: "Recent reviews", columns: ["Pull request", "Repository", "Verdict", "Quality", "Blast", "Reviewed"],
      rows: all.slice(0, 8).map((r) => [
        { text: `#${r.pr.number} ${r.pr.title}`, path: `/review?pr=${encodeURIComponent(r.pr.url)}` },
        repoLabel(repoOf(r.pr)),
        VERDICT_CELL[r.review.verdict] || VERDICT_CELL.comment,
        r.review.scores.quality,
        r.blast.score,
        new Date(r.at).toLocaleDateString(undefined, { day: "numeric", month: "short" }),
      ]) },
    { id: "links", kind: "links", title: "Quick links", items: [
      { label: "Repositories", hint: "Add or remove onboarded repositories", path: "/settings/repos" },
      { label: "Sign-in (OAuth)", hint: "GitHub, Forgejo and Gitea login", path: "/settings/oauth" },
      { label: "Documentation", hint: "README on GitHub", href: "https://github.com/dharmeshgurnani/CodeOtter#readme" },
    ] },
  ];
  return { sections };
}
function requestOrg(url) {
  const org = url.searchParams.get("org") || "";
  if (org && !OWNER_RE.test(org)) throw new Error("Bad organization");
  return org;
}
function checkRepoScope(repo, org) {
  if (!REPO_RE.test(repo) || (isForgeRepo(repo) && !forgeUrl(repo))) throw new Error("Invalid repository");
  if (org && !repo.startsWith(`${org}/`)) throw new Error("Repository is outside the active organization");
}
// Cookies: pr_oauth is an opaque key for server-held state/PKCE; pr_auth is the PocketBase user token.
const cookies = (req) => Object.fromEntries((req.headers.cookie || "").split(";").map((c) => c.trim().split("=")).filter(([k]) => k).map(([k, ...v]) => { try { return [k, decodeURIComponent(v.join("="))]; } catch { return [k, ""]; } }));
const setCookie = (res, name, value, maxAge) => {
  const prev = res.getHeader("set-cookie") || [];
  res.setHeader("set-cookie", [...(Array.isArray(prev) ? prev : [prev]), `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${APP_URL.startsWith("https") ? "; Secure" : ""}`]);
};
// Account types. owner: everything. admin: everything except Accounts and sign-in configuration. developer: reserved.
// The first account to sign in becomes owner; later ones admin. Until any account exists, an anonymous visitor
// is treated as owner so the instance can be set up (bootstrap); once an owner exists, anonymous gets no settings.
const ROLES = ["owner", "admin"];
const userView = (rec) => ({ id: rec.id, name: rec.name || rec.username || rec.email?.split("@")[0] || "User", email: rec.email || "", role: rec.role || "", avatar: rec.avatar ? `/api/me/avatar?id=${rec.id}&f=${encodeURIComponent(rec.avatar)}` : "" });
async function currentUser(req) {
  const token = cookies(req).pr_auth;
  if (!token || !PB_URL) return null;
  const r = await store.authRefresh(token);
  if (!r) return null;
  if (!r.record.role) {
    // first account becomes owner, later ones admin
    const owners = (await store.users()).filter((u) => u.role === "owner").length;
    r.record.role = owners ? "admin" : "owner";
    await store.setRole(r.record.id, r.record.role);
  }
  return { ...userView(r.record), token: r.token };
}
const hasUsers = async () => (PB_URL ? (await store.users()).length > 0 : false);
// effective role for access checks: the real role; an anonymous visitor counts as owner only while no account exists
// yet (bootstrap) or when the operator sets PR_SCORER_RECOVERY=1 (locked out: restart with it, fix sign-in, unset it).
const RECOVERY = process.env.PR_SCORER_RECOVERY === "1";
const effectiveRole = async (user) => user?.role || (RECOVERY || !PB_URL || !(await hasUsers()) ? "owner" : "");
const allowed = (role, access) => (access === "owner" ? role === "owner" : access === "admin" ? ROLES.includes(role) : true);
// Gate: every data endpoint needs at least the admin role (owner during bootstrap). 403 carries login:true when signed out.
async function gate(req, res, access = "admin") {
  const user = await currentUser(req);
  if (allowed(await effectiveRole(user), access)) return { user, ok: true };
  res.statusCode = 403;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ error: user ? `This needs the ${access} role` : "Sign in to continue", login: !user }));
  return { user, ok: false };
}
const readJson = (req) =>
  new Promise((ok, err) => {
    let b = "";
    req.on("data", (d) => { b += d; if (b.length > 1e6) { req.destroy(); err(new Error("Request body too large")); } }).on("end", () => { try { ok(b ? JSON.parse(b) : {}); } catch (e) { err(e); } }).on("error", err);
  });

await store.init();
for (const [id, f] of Object.entries(FORGES)) {
  const saved = await store.getSetting(id);
  if (saved) { f.url = forgeOrigin(saved.url); f.token = saved.token || ""; }
}
const origins = Object.values(FORGES).map((f) => f.url).filter(Boolean);
if (new Set(origins).size !== origins.length) throw new Error("Each provider must use a separate server origin");
for (const [id, f] of Object.entries(FORGES)) {
  const previous = await store.getSetting(`${id}Origin`);
  if (previous && previous !== f.url) {
    const linked = (await repos()).some((r) => forgeId(r) === id) || (await store.all()).some((r) => r.pr?.url?.startsWith(`${previous}/`));
    if (linked || (PB_URL && ((await store.getOAuth()).providers.some((p) => p.name === f.pb) || await store.hasForgeIdentities(f.pb)))) throw new Error(`${f.label} origin changed while repositories or OAuth identities are linked`);
  }
  if (f.url && previous !== f.url) await store.setSetting(`${id}Origin`, f.url);
}
http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const json = (o) => (res.setHeader("content-type", "application/json"), res.end(JSON.stringify(o)));
    try {
      // Cross-site requests never reach the API (defence in depth on top of SameSite=Lax cookies).
      if ((url.pathname.startsWith("/api/") || url.pathname === "/score") && req.headers["sec-fetch-site"] === "cross-site") { res.statusCode = 403; return json({ error: "Cross-site request refused" }); }
      if (url.pathname === "/api/reviews") {
        const g = await gate(req, res);
        if (!g.ok) return;
        const c = await llmConfig();
        const rs = await repos();
        const org = requestOrg(url);
        const scoped = rs.filter((r) => !org || r.startsWith(`${org}/`));
        const onboardingComplete = (await store.getSetting("onboardingComplete")) === true;
        const onboardingNeeded = !onboardingComplete && rs.length === 0;
        return json({ repo: scoped[0] || "", repos: rs, onboardingNeeded, forgejoUrl: FORGES.forgejo.url, forgeUrls: Object.fromEntries(Object.entries(FORGES).map(([id, f]) => [id, f.url])), model: `${c.provider}/${c.model}`, baseUrl: c.baseUrl, store: PB_URL ? "pocketbase" : "files", update: availableUpdate(), settingsPages: await settingsPages(g.user), reviewed: (await store.all()).filter((r) => !org || repoOf(r.pr).startsWith(`${org}/`)), open: (await Promise.all(scoped.map(openPrs))).flat() });
      }
      if (url.pathname.startsWith("/api/onboarding")) {
        const g = await gate(req, res, "admin");
        if (!g.ok) return;
        if (url.pathname === "/api/onboarding" || url.pathname === "/api/onboarding/status") {
          const rs = await repos();
          const savedComplete = (await store.getSetting("onboardingComplete")) === true;
          const s1 = await s1Config();
          const llm = await llmConfig();
          const o = PB_URL ? await store.getOAuth() : null;
          return json({
            completed: savedComplete && rs.length > 0,
            appUrl: APP_URL,
            hasPb: !!PB_URL,
            primaryProvider: (await store.getSetting("primaryProvider")) || (FORGES.forgejo.url ? "forgejo" : FORGES.gitea.url ? "gitea" : "github"),
            forges: Object.fromEntries(Object.entries(FORGES).map(([id, f]) => [id, { url: f.url, configured: !!f.url && !!f.token }])),
            oauth: o,
            repos: rs,
            s1: { provider: s1.provider, model: s1.model, baseUrl: s1.baseUrl, hasKey: !!s1.apiKey },
            llm: { provider: llm.provider, model: llm.model, baseUrl: llm.baseUrl, hasKey: !!llm.apiKey },
            localModels: {
              s1: LOCAL_S1.map((m) => ({ id: m.id, label: m.label, sizeMB: m.sizeMB, status: localStatus(m).state, info: contextNote(m) })),
              llm: LOCAL_LLM.map((m) => ({ id: m.id, label: m.label, sizeMB: m.sizeMB, status: localStatus(m).state })),
            },
          });
        }
        if (url.pathname === "/api/onboarding/repos") {
          const choices = await repositoryChoices();
          return json({ repos: choices.map((r) => ({ id: r, label: repoLabel(r), org: r.split("/")[0] })) });
        }
        if (url.pathname === "/api/onboarding/test-provider" && req.method === "POST") {
          const body = await readJson(req);
          const provider = body.provider || "github";
          if (provider === "github") {
            try {
              if (body.token) {
                const r = await fetch("https://api.github.com/user", { headers: { authorization: `token ${body.token}`, "user-agent": "CodeOtter" } });
                if (!r.ok) throw new Error(`GitHub token verification failed (${r.status})`);
                const user = await r.json();
                return json({ ok: true, message: `Connected as @${user.login}` });
              }
              const out = gh("repo", "list", "--limit", "1", "--json", "nameWithOwner");
              return json({ ok: true, message: "Connected via GitHub CLI" });
            } catch (err) {
              return json({ ok: false, error: err.message });
            }
          }
          if (provider === "forgejo" || provider === "gitea") {
            try {
              const origin = forgeOrigin(body.url || FORGES[provider].url);
              const token = body.token || FORGES[provider].token;
              if (!origin) throw new Error(`Please provide a ${FORGES[provider].label} server URL`);
              const res = await fetch(`${origin}/api/v1/user`, { headers: { ...(token ? { authorization: `token ${token}` } : {}), accept: "application/json" } });
              if (!res.ok) throw new Error(`${FORGES[provider].label} returned HTTP ${res.status}`);
              const user = await res.json();
              return json({ ok: true, message: `Connected to ${FORGES[provider].label} as @${user.username || user.login || "user"}` });
            } catch (err) {
              return json({ ok: false, error: err.message });
            }
          }
          throw new Error("Unknown provider");
        }
        if (url.pathname === "/api/onboarding/save-provider" && req.method === "POST") {
          const body = await readJson(req);
          const provider = body.provider || "github";
          await store.setSetting("primaryProvider", provider);
          if (provider === "github" && body.token) {
            const tok = String(body.token).trim();
            await store.setSetting("githubToken", tok);
            process.env.GITHUB_TOKEN = tok;
            process.env.GH_TOKEN = tok;
            ghReposCache = null;
          }
          if (provider === "forgejo" || provider === "gitea") {
            const nextUrl = forgeOrigin(body.url);
            const token = String(body.token || "");
            if (nextUrl) {
              await store.setSetting(provider, { url: nextUrl, token });
              await store.setSetting(`${provider}Origin`, nextUrl);
              FORGES[provider].url = nextUrl;
              FORGES[provider].token = token;
            }
          }
          if (PB_URL && (body.clientId || body.clientSecret)) {
            const o = await store.getOAuth();
            const spec = LOGIN_PROVIDERS[provider];
            if (spec) {
              const providers = o.providers.filter((p) => p.name !== spec.pb);
              providers.push({
                name: spec.pb,
                clientId: String(body.clientId || "").trim(),
                ...(body.clientSecret ? { clientSecret: String(body.clientSecret) } : {}),
                ...(provider !== "github" ? {
                  displayName: spec.label,
                  pkce: true,
                  authURL: `${FORGES[provider].url}/login/oauth/authorize`,
                  tokenURL: `${FORGES[provider].url}/login/oauth/access_token`,
                  userInfoURL: provider === "gitea" ? `${FORGES[provider].url}/api/v1/user` : `${FORGES[provider].url}/login/oauth/userinfo`,
                } : {}),
              });
              await store.setOAuth({ ...o, enabled: true, providers });
            }
          }
          return json({ ok: true });
        }
        if (url.pathname === "/api/onboarding/save-models" && req.method === "POST") {
          const body = await readJson(req);
          if (body.s1) {
            const s1 = body.s1;
            if (LOCAL_S1.some((m) => m.id === s1.provider)) {
              await store.setSetting("s1", { provider: s1.provider });
              const m = LOCAL[s1.provider];
              if (m && !modelReady(m) && !downloads.get(m.id)?.active) downloadModel(m);
            } else if (S1_PROVIDERS[s1.provider] || s1.provider === "custom") {
              await store.setSetting("s1", { provider: s1.provider, model: s1.model || "", apiKey: s1.apiKey || "", baseUrl: s1.baseUrl || "" });
            }
          }
          if (body.llm) {
            const llm = body.llm;
            if (LOCAL_LLM.some((m) => m.id === llm.provider)) {
              await store.setSetting("llm", { provider: `local_${llm.provider}` });
              const m = LOCAL[llm.provider];
              if (m && !modelReady(m) && !downloads.get(m.id)?.active) downloadModel(m);
            } else if (PROVIDERS[llm.provider]) {
              await store.setSetting("llm", { provider: llm.provider, model: llm.model || "", apiKey: llm.apiKey || "", baseUrl: llm.baseUrl || "" });
            }
          }
          modelCache.clear();
          return json({ ok: true });
        }
        if (url.pathname === "/api/onboarding/save-repos" && req.method === "POST") {
          const body = await readJson(req);
          const nextRepos = Array.isArray(body.repos) ? body.repos.filter(Boolean) : [];
          if (!nextRepos.length) throw new Error("Please select at least one repository");
          await store.setSetting("repos", nextRepos);
          return json({ ok: true, repos: nextRepos });
        }
        if (url.pathname === "/api/onboarding/complete" && req.method === "POST") {
          await store.setSetting("onboardingComplete", true);
          const rs = await repos();
          const primaryOrg = rs[0] ? rs[0].split("/")[0] : "";
          return json({ ok: true, org: primaryOrg });
        }
      }
      if (url.pathname === "/api/home") {
        if (!(await gate(req, res)).ok) return;
        const org = url.searchParams.get("org") || "";
        if (org && !OWNER_RE.test(org)) throw new Error("Bad organization");
        return json(await homeData(org));
      }
      if (url.pathname === "/api/login") {
        // Showcase content for the login page's right column: showcase.json next to the server, editable without code.
        const file = join(import.meta.dirname, "showcase.json");
        const showcase = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { headline: "PR Scorer", sub: "", groups: [] };
        let providers = [];
        if (PB_URL) { try { const m = await store.authMethods(); providers = Object.entries(LOGIN_PROVIDERS).filter(([, spec]) => m.oauth2?.enabled && m.oauth2.providers.some((p) => p.name === spec.pb)).map(([id, spec]) => ({ id, label: spec.label })); } catch {} }
        return json({ showcase, signInAvailable: !!PB_URL, configured: providers.length > 0, providers });
      }
      if (url.pathname === "/api/me") {
        const u = await currentUser(req);
        return json({ user: u ? { id: u.id, name: u.name, email: u.email, role: u.role, avatar: u.avatar } : null, signInAvailable: !!PB_URL });
      }
      if (url.pathname === "/api/me/avatar") {
        const u = await currentUser(req);
        if (!u || u.id !== url.searchParams.get("id")) { res.statusCode = 404; return res.end(); }
        const f0 = url.searchParams.get("f") || "";
        if (!/^[\w.-]+$/.test(f0)) { res.statusCode = 404; return res.end(); }
        const f = await store.userFile(u.id, f0);
        res.statusCode = f.status;
        res.setHeader("content-type", f.headers.get("content-type") || "image/png");
        res.setHeader("cache-control", "private, max-age=3600");
        return res.end(Buffer.from(await f.arrayBuffer()));
      }
      if (url.pathname === "/api/auth/start") {
        if (!PB_URL) throw new Error("Sign-in is not available in file-storage mode (set PB_URL)");
        const m = await store.authMethods();
        const id = url.searchParams.get("provider") || "github";
        const spec = Object.hasOwn(LOGIN_PROVIDERS, id) && LOGIN_PROVIDERS[id];
        if (!spec) throw new Error("Unsupported sign-in provider");
        const gh = m.oauth2?.enabled && m.oauth2.providers.find((p) => p.name === spec.pb);
        if (!gh) throw new Error(`${spec.label} sign-in is not configured: open Admin / OAuth`);
        const back = url.searchParams.get("back") || "/";
        for (const [key, flow] of oauthFlows) if (flow.expires < Date.now()) oauthFlows.delete(key);
        if (oauthFlows.size >= 1000) throw new Error("Too many pending sign-ins; try again later");
        const key = randomBytes(32).toString("hex");
        oauthFlows.set(key, { provider: spec.pb, state: gh.state, codeVerifier: gh.codeVerifier, back: /^\/(?![\/\\])/.test(back) ? back : "/", expires: Date.now() + 600000 });
        setCookie(res, "pr_oauth", key, 600);
        return json({ url: gh.authURL + encodeURIComponent(`${APP_URL}/auth/callback`) });
      }
      if (url.pathname === "/auth/callback") {
        const key = cookies(req).pr_oauth;
        const flow = oauthFlows.get(key);
        oauthFlows.delete(key);
        setCookie(res, "pr_oauth", "", 0);
        const fail = (msg) => { res.statusCode = 302; res.setHeader("location", `/login?login_error=${encodeURIComponent(msg)}`); return res.end(); };
        if (!flow || flow.expires < Date.now() || flow.state !== url.searchParams.get("state")) return fail("Sign-in state mismatch, try again");
        if (url.searchParams.get("error")) return fail(url.searchParams.get("error_description") || url.searchParams.get("error"));
        let auth;
        try {
          auth = await store.authWithOAuth2({ provider: flow.provider, code: url.searchParams.get("code"), codeVerifier: flow.codeVerifier, redirectURL: `${APP_URL}/auth/callback` });
        } catch (e) {
          return fail(e.message);
        }
        setCookie(res, "pr_oauth", "", 0);
        setCookie(res, "pr_auth", auth.token, 14 * 86400);
        res.statusCode = 302;
        res.setHeader("location", flow.back || "/");
        return res.end();
      }
      if (url.pathname === "/api/auth/logout" && req.method === "POST") {
        setCookie(res, "pr_auth", "", 0);
        return json({ ok: true });
      }
      if (url.pathname === "/github/manifest/callback") {
        const returnTo = cookies(req).pr_manifest_return || "/settings/oauth";
        const fail = (msg) => { res.statusCode = 302; res.setHeader("location", `${returnTo}?error=${encodeURIComponent(msg)}`); return res.end(); };
        if (!cookies(req).pr_manifest || cookies(req).pr_manifest !== url.searchParams.get("state")) return fail("GitHub app creation state mismatch, try again");
        const conv = await fetch(`https://api.github.com/app-manifests/${encodeURIComponent(url.searchParams.get("code"))}/conversions`, { method: "POST", headers: { accept: "application/vnd.github+json", "user-agent": "CodeOtter" } });
        if (!conv.ok) return fail(`GitHub rejected the app manifest (${conv.status})`);
        const app = await conv.json();
        const o = await store.getOAuth();
        await store.setOAuth({ ...o, enabled: true, providers: [...o.providers.filter((p) => p.name !== "github"), { name: "github", clientId: app.client_id, clientSecret: app.client_secret }] });
        await store.setSetting("primaryProvider", "github");
        await store.setSetting("githubApp", {
          id: app.id,
          slug: app.slug,
          owner: app.owner?.login || "",
          pem: app.pem || "",
          clientId: app.client_id,
          clientSecret: app.client_secret,
        });
        if (app.owner?.login) {
          await store.setSetting("githubOwner", app.owner.login);
        }
        setCookie(res, "pr_manifest", "", 0);
        setCookie(res, "pr_manifest_return", "", 0);
        ghReposCache = null;
        if (app.slug && returnTo.startsWith("/onboarding")) {
          res.statusCode = 302;
          res.setHeader("location", `https://github.com/apps/${encodeURIComponent(app.slug)}/installations/new`);
          return res.end();
        }
        res.statusCode = 302;
        res.setHeader("location", `${returnTo}?connected=${encodeURIComponent(app.html_url || app.slug || "github")}`);
        return res.end();
      }
      const m = url.pathname.match(/^\/api\/settings\/([a-z]+)(?:\/([a-z]+))?$/);
      if (m) {
        const page = SETTINGS_PAGES[m[1]];
        if (!page) throw new Error(`No settings page ${m[1]}`);
        const g = await gate(req, res, page.access);
        if (!g.ok) return;
        const user = g.user;
        if (m[2] && req.method !== "POST") { res.statusCode = 405; return json({ error: "POST only" }); }
        if (m[2] === "test") return json(await page.test());
        if (m[2]) {
          const action = page.actions?.[m[2]];
          if (!action) throw new Error(`No action ${m[2]} on ${m[1]}`);
          return json(await action(req, res, await readJson(req)));
        }
        const scope = { org: url.searchParams.get("org") || "" };
        if (scope.org && !OWNER_RE.test(scope.org)) throw new Error("Bad organization");
        if (req.method === "POST") await page.save(await readJson(req), scope, user);
        return json(await page.load(scope, user));
      }
      if (url.pathname === "/api/learnings" && req.method === "POST") {
        const g = await gate(req, res, "admin");
        if (!g.ok) return;
        const body = await readJson(req);
        const prUrl = String(body.prUrl || "").trim();
        const repo = String(body.repo || (prUrl ? repoOf({ url: prUrl }) : "")).trim();
        checkRepoScope(repo, requestOrg(url));
        if (prUrl && repoOf({ url: prUrl }) !== repo) throw new Error("PR and repository mismatch");
        const fileBit = String(body.file || "").trim();
        const titleBit = String(body.title || "").trim();
        const detailBit = String(body.detail || "").trim().split("\n")[0].slice(0, 140);
        const ruleText = String(
          body.rule ||
          (fileBit && titleBit
            ? `[${fileBit}] Ignore pattern: ${titleBit}`
            : titleBit
              ? `Ignore pattern: ${titleBit}`
              : fileBit && detailBit
                ? `[${fileBit}] Ignore pattern: ${detailBit}`
                : detailBit || "Ignore dismissed finding pattern"),
        )
          .trim()
          .slice(0, 300);
        const prev = await getRepoLearnings(repo);
        const learnings = await setRepoLearnings(repo, [...prev, ruleText]);
        let updatedReview = null;
        if (prUrl && validPrUrl(prUrl)) {
          const stored = await store.get(prUrl).catch(() => null);
          const active = activeReviews.get(prUrl)?.state || null;
          const target = stored || active;
          if (target) {
            const markDismissed = (rObj) => {
              if (!rObj?.review?.findings) return rObj;
              let matched = false;
              const nextFindings = rObj.review.findings.map((f) => {
                if (!matched && !f.dismissed) {
                  const sameFile = !fileBit || String(f.file || "") === fileBit;
                  const sameTitle = !titleBit || String(f.title || "") === titleBit;
                  if (sameFile && sameTitle) {
                    matched = true;
                    return { ...f, dismissed: true };
                  }
                }
                return f;
              });
              return { ...rObj, learnings, review: { ...rObj.review, findings: nextFindings } };
            };
            updatedReview = markDismissed(target);
            if (stored) await store.put(updatedReview);
            if (activeReviews.get(prUrl)) activeReviews.get(prUrl).state = markDismissed(activeReviews.get(prUrl).state);
          }
        }
        return json({ ok: true, learnings, review: updatedReview });
      }
      if (url.pathname === "/api/tools") {
        const g = await gate(req, res, "admin");
        if (!g.ok) return;
        if (req.method !== "POST") return json(Object.entries(PR_TOOLS).map(([id, t]) => ({ id, label: t.label, input: t.input || null, apply: t.applyLabel || null })));
        const body = await readJson(req);
        const prUrl = String(body.prUrl || "").trim();
        if (!validPrUrl(prUrl)) throw new Error("Invalid pull request URL");
        checkRepoScope(repoOf({ url: prUrl }), requestOrg(url));
        return json(await runPrTool(prUrl, String(body.tool || ""), { question: body.question, action: String(body.action || "run") }));
      }
      if (url.pathname === "/api/review-suggestions" && req.method === "POST") {
        const g = await gate(req, res, "admin");
        if (!g.ok) return;
        const body = await readJson(req);
        const prUrl = String(body.prUrl || "").trim();
        if (!prUrl || !validPrUrl(prUrl)) throw new Error("Invalid pull request URL");
        const repo = String(body.repo || repoOf({ url: prUrl })).trim();
        checkRepoScope(repo, requestOrg(url));
        if (repoOf({ url: prUrl }) !== repo) throw new Error("PR and repository mismatch");
        const prNum = parsePrUrl(prUrl).number;
        const stored = await store.get(prUrl).catch(() => null);
        const active = activeReviews.get(prUrl)?.state || null;
        let target = stored || active;
        if (!target) {
          target = {
            pr: { url: prUrl, number: prNum },
            headSha: String(body.headSha || ""),
            review: {
              findings: body.file
                ? [
                    {
                      file: String(body.file || ""),
                      line: Number(body.line) || 0,
                      severity: String(body.severity || "low"),
                      title: String(body.title || ""),
                      detail: String(body.detail || ""),
                      suggestion: String(body.suggestion || ""),
                    },
                  ]
                : [],
            },
          };
        } else if (body.findingIdx !== undefined && body.findingIdx !== null) {
          const idx = Number(body.findingIdx);
          if (Array.isArray(target.review?.findings) && target.review.findings[idx]) {
            const existingF = target.review.findings[idx];
            target.review.findings[idx] = deriveSuggestionFromDetail(
              {
                ...existingF,
                ...(body.line ? { line: Number(body.line) } : {}),
                ...(body.suggestion !== undefined ? { suggestion: String(body.suggestion) } : {}),
              },
              "",
            );
          }
        }
        const resInfo = await postInlineSuggestionsOnPr(target, repo, {
          findingIdx: body.findingIdx !== undefined && body.findingIdx !== null ? Number(body.findingIdx) : null,
        });
        if (stored && resInfo.posted > 0) {
          const tag = resInfo.comments[0]
            ? `inline suggestion (${resInfo.comments[0].path}:L${resInfo.comments[0].line})`
            : `inline suggestions (${resInfo.posted})`;
          const nextPosted = [...new Set([...(stored.commentsPosted || []), tag])];
          const updated = { ...stored, commentsPosted: nextPosted, review: target.review };
          await store.put(updated);
          if (activeReviews.get(prUrl)) activeReviews.get(prUrl).state = updated;
        }
        return json({ ok: true, ...resInfo });
      }
      if (url.pathname === "/api/triage") {
        if (!(await gate(req, res)).ok) return;
        const org = requestOrg(url);
        const results = (await store.getSetting("triageResults")) || {};
        const ref = (url.searchParams.get("pr") || "").trim();
        if (!ref) return json(Object.values(results).filter((t) => { try { checkRepoScope(t.repo, org); return true; } catch { return false; } }));
        const resolved = await resolvePr(ref, url.searchParams.get("repo") || "");
        checkRepoScope(parsePrUrl(resolved.urlGuess).repo, org);
        if (req.method === "POST") return json(await triagePr(ref, url.searchParams.get("repo") || ""));
        return json(results[resolved.urlGuess] || null);
      }
      if (url.pathname === "/api/score" || (url.pathname === "/score" && url.searchParams.get("pr"))) {
        if (!(await gate(req, res)).ok) return;
        const ref = (url.searchParams.get("pr") || "").trim();
        if (!ref) throw new Error("Missing pr");
        const force = url.searchParams.has("force");
        const repo = url.searchParams.get("repo") || "";
        const resolved = await resolvePr(ref, repo);
        checkRepoScope(parsePrUrl(resolved.urlGuess).repo, requestOrg(url));
        const part = url.searchParams.get("part") || "";
        if (url.pathname === "/api/score" && url.searchParams.has("async")) {
          return json(await startOrPollReview(ref, force, repo, part));
        }
        const result = await score(ref, force, repo);
        if (url.pathname === "/api/score") return json(result);
        res.setHeader("content-type", "text/html; charset=utf-8");
        return res.end(renderScore(result));
      }
      if (url.pathname === "/api/hf-avatar") {
        const owner = (url.searchParams.get("owner") || "").trim();
        let target = HF_AVATARS[owner.toLowerCase()];
        if (!target && OWNER_RE.test(owner)) {
          for (const ep of ["organizations", "users"]) {
            try {
              const r = await fetch(`https://huggingface.co/api/${ep}/${encodeURIComponent(owner)}/overview`, { signal: AbortSignal.timeout(4000) });
              if (r.ok) {
                const av = (await r.json()).avatarUrl;
                if (av) { target = av; HF_AVATARS[owner.toLowerCase()] = av; break; }
              }
            } catch {}
          }
        }
        res.statusCode = 302;
        res.setHeader("location", target || HF_LOGO);
        res.setHeader("cache-control", "public, max-age=86400");
        return res.end();
      }
      if (url.pathname === "/favicon.svg") {
        const file = [join(DIST, "favicon.svg"), join(import.meta.dirname, "web", "public", "favicon.svg")].find(existsSync);
        res.setHeader("content-type", "image/svg+xml; charset=utf-8");
        res.setHeader("cache-control", "public, max-age=86400");
        if (file) return res.end(readFileSync(file));
        return res.end(DEFAULT_FAVICON_SVG);
      }
      if (url.pathname === "/og.svg") {
        const prParam = url.searchParams.get("pr") || "";
        const cachedPr = prParam ? await store.get(prParam).catch(() => null) : null;
        const ogTitle = cachedPr
          ? `#${cachedPr.pr.number} ${cachedPr.pr.title}`.slice(0, 72)
          : (url.searchParams.get("title") || "CodeOtter — AI Pull Request Review & Merge Gates").slice(0, 72);
        const ogSub = cachedPr
          ? `${repoOf(cachedPr.pr)} · Quality ${cachedPr.review?.scores?.quality ?? 0}/100 · Blast Radius ${cachedPr.blast?.score ?? 0}/100 · ${cachedPr.pr.changedFiles} files (+${cachedPr.pr.additions}/-${cachedPr.pr.deletions})`
          : (url.searchParams.get("sub") || "Automated AI code review, blast-radius scoring, AGENTS.md / CLAUDE.md guideline checks & pre-merge gates.").slice(0, 110);
        res.setHeader("content-type", "image/svg+xml; charset=utf-8");
        res.setHeader("cache-control", "public, max-age=3600");
        const ogIcon = `<g transform="translate(96, 94) scale(0.125)"><rect width="512" height="512" rx="104" fill="#BE3609"/>${CODEOTTER_PATH_TAG}</g>`;
        return res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="#0d1117"/><rect x="48" y="48" width="1104" height="534" rx="24" fill="#161b22" stroke="#30363d" stroke-width="2"/>${ogIcon}<text x="180" y="140" fill="#f0f6fc" font-family="Inter,system-ui,sans-serif" font-size="38" font-weight="700">CodeOtter</text><text x="96" y="280" fill="#ffffff" font-family="Inter,system-ui,sans-serif" font-size="46" font-weight="700">${esc(ogTitle)}</text><text x="96" y="355" fill="#8b949e" font-family="ui-monospace,SFMono-Regular,Consolas,monospace" font-size="25">${esc(ogSub)}</text><text x="96" y="510" fill="#f59e0b" font-family="Inter,system-ui,sans-serif" font-size="22" font-weight="600">AI Pull Request Review · Blast Radius · Merge Gates</text></svg>`);
      }
      // ponytail: serve the built React app when it exists, fall back to the server-rendered pages otherwise
      const ext = url.pathname.split(".").pop();
      const asset = join(DIST, url.pathname);
      if (existsSync(DIST)) {
        if (MIME[ext] && existsSync(asset)) {
          res.setHeader("content-type", `${MIME[ext]}; charset=utf-8`);
          return res.end(readFileSync(asset));
        }
        let html = readFileSync(join(DIST, "index.html"), "utf8");
        let pageTitle = "CodeOtter — AI Pull Request Review, Blast Radius & Merge Gates";
        let pageDesc = "Automated AI pull request reviews, calibrated quality & blast-radius scores, repository guideline enforcement (AGENTS.md / CLAUDE.md), and pre-merge safety gates.";
        let ogType = "website";
        let ogImg = `${APP_URL}/og.svg`;
        if (url.pathname === "/review" && url.searchParams.get("pr")) {
          const ref = url.searchParams.get("pr") || "";
          const cPr = await store.get(ref).catch(() => null);
          if (cPr?.pr) {
            const [vl] = VERDICT[cPr.review?.verdict] || ["Commented"];
            pageTitle = `PR #${cPr.pr.number}: ${cPr.pr.title} (${repoOf(cPr.pr)}) · CodeOtter`;
            pageDesc = `Verdict: ${vl} · Quality ${cPr.review?.scores?.quality ?? 0}/100 · Blast Radius ${cPr.blast?.score ?? 0}/100 · ${cPr.pr.changedFiles} files (+${cPr.pr.additions}/-${cPr.pr.deletions}) — ${String(cPr.review?.summary || "").slice(0, 160)}`;
            ogType = "article";
            ogImg = `${APP_URL}/og.svg?pr=${encodeURIComponent(cPr.pr.url)}`;
          } else {
            const num = ref.split("/").pop() || ref;
            pageTitle = `PR #${num} Review · CodeOtter`;
            pageDesc = `AI pull request review, quality score, and blast radius analysis for PR #${num} on CodeOtter.`;
          }
        } else if (url.pathname.startsWith("/repo/")) {
          const parts = url.pathname.slice("/repo/".length).split("/");
          const rName = parts.slice(0, 2).join("/");
          const isOpen = parts[2] === "open";
          pageTitle = `${rName} — ${isOpen ? "Open Pull Requests" : "PR Reviews"} · CodeOtter`;
          pageDesc = isOpen
            ? `Open pull requests waiting for AI code review in ${rName} on CodeOtter.`
            : `Completed AI pull request reviews, quality scores, and blast radius assessments for ${rName} on CodeOtter.`;
          ogImg = `${APP_URL}/og.svg?title=${encodeURIComponent(pageTitle)}&sub=${encodeURIComponent(pageDesc)}`;
        } else if (url.pathname.startsWith("/settings/")) {
          const sId = url.pathname.slice("/settings/".length);
          const sp = SETTINGS_PAGES[sId];
          if (sp) {
            const sec = sp.group === "admin" ? "Admin" : "Settings";
            pageTitle = `${sp.title} — ${sec} · CodeOtter`;
            pageDesc = `Configure ${sp.title.toLowerCase()} settings on CodeOtter.`;
          }
        } else if (url.pathname === "/login") {
          pageTitle = "Sign in · CodeOtter";
          pageDesc = "Sign in to access CodeOtter AI pull request reviews, blast radius metrics, and merge gates.";
        }
        const canonical = `${APP_URL}${url.pathname}${url.search}`;
        html = html
          .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(pageTitle)}</title>`)
          .replace(/<meta\s+name="description"\s+content="[^"]*"\s*\/>/, `<meta name="description" content="${esc(pageDesc)}" />`)
          .replace(/<meta\s+property="og:type"\s+content="[^"]*"\s*\/>/, `<meta property="og:type" content="${esc(ogType)}" />`)
          .replace(/<meta\s+property="og:title"\s+content="[^"]*"\s*\/>/, `<meta property="og:title" content="${esc(pageTitle)}" />`)
          .replace(/<meta\s+property="og:description"\s+content="[^"]*"\s*\/>/, `<meta property="og:description" content="${esc(pageDesc)}" />`)
          .replace(/<meta\s+property="og:url"\s+content="[^"]*"\s*\/>/, `<meta property="og:url" content="${esc(canonical)}" />`)
          .replace(/<meta\s+property="og:image"\s+content="[^"]*"\s*\/>/, `<meta property="og:image" content="${esc(ogImg)}" />`)
          .replace(/<meta\s+name="twitter:title"\s+content="[^"]*"\s*\/>/, `<meta name="twitter:title" content="${esc(pageTitle)}" />`)
          .replace(/<meta\s+name="twitter:description"\s+content="[^"]*"\s*\/>/, `<meta name="twitter:description" content="${esc(pageDesc)}" />`)
          .replace(/<meta\s+name="twitter:image"\s+content="[^"]*"\s*\/>/, `<meta name="twitter:image" content="${esc(ogImg)}" />`)
          .replace(/<\/head>/, `<link rel="canonical" href="${esc(canonical)}" />\n  </head>`);
        res.setHeader("content-type", "text/html; charset=utf-8");
        return res.end(html);
      }
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(await renderHome());
    } catch (e) {
      res.statusCode = 500;
      const detail = e.cause ? ` (${e.cause.code || e.cause.message || e.cause})` : "";
      const msg = e.message === "fetch failed" ? `Fetch failed: connection error or endpoint unreachable${detail}` : `${e.message}${detail}`;
      console.error(`[API Error] ${req.method} ${url.pathname}:`, e.stack || e);
      json({ error: msg });
    }
  })
  .setTimeout(0) // Node cuts requests at 300 s by default; a cold local sidecar plus a long review can take longer
  .listen(PORT, async () => console.log(`CodeOtter on http://localhost:${PORT} (repo ${REPO}, model ${(await llmConfig()).model}, store ${PB_URL ? `PocketBase ${PB_URL}` : "scores/"})`));
