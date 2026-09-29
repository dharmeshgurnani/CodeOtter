// pr-scorer: zero-dependency PR quality + blast-radius scorer. `node server.mjs` then open http://localhost:4747
import http from "node:http";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, createWriteStream, statSync, renameSync, rmSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { join } from "node:path";

const PORT = process.env.PORT || 4747;
// Public address of this app, used for the OAuth callback. Set APP_URL when deployed behind a domain.
const APP_URL = (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/+$/, "");
// ponytail: default repo = the git repo you launch from; set REPO to point elsewhere
const REPO = process.env.REPO || repoFromCwd();
function repoFromCwd() {
  try {
    return execFileSync("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
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
  anthropic: { label: "Anthropic", api: "anthropic", baseUrl: "https://api.anthropic.com", models: ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"], keyEnv: "ANTHROPIC_API_KEY", keyUrl: "https://console.anthropic.com/settings/keys" },
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

// Store: PocketBase when PB_URL is set (the Docker image sets it), plain JSON files in scores/ otherwise.
const PB_URL = process.env.PB_URL;
const SCORES = join(import.meta.dirname, "scores");
const CONFIG = join(import.meta.dirname, "config.json");
const readConfig = () => (existsSync(CONFIG) ? JSON.parse(readFileSync(CONFIG, "utf8")) : {});
const keyOf = (url) => url.replace("https://github.com/", "").replace(/\//g, "-");
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

let pbToken = "";
async function pbAuth() {
  const res = await fetch(`${PB_URL}/api/collections/_superusers/auth-with-password`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identity: process.env.PB_ADMIN_EMAIL, password: process.env.PB_ADMIN_PASSWORD }),
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
const OWNER_RE = /^[\w.-]+$/;
const REPO_RE = /^[\w.-]+\/[\w.-]+$/;
const PR_URL_RE = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/;

const HOTSPOTS = [
  ["migrations", /(^|\/)migrations\//i],
  ["auth / security", /auth|acl|permission|middleware|secret|token/i],
  ["payments / money", /payment|invoice|billing|stripe|fee/i],
  ["public API routes", /(^|\/)(api|routes)\//i],
  ["core domain", /\bcore\//],
  ["dependencies", /package\.json|pnpm-lock\.yaml|yarn\.lock|package-lock\.json|go\.sum|Cargo\.lock/],
  ["CI / deploy", /\.github\/|railway\.json|Dockerfile|docker-compose|\.gitlab-ci/],
];

function blastRadius(files) {
  const lines = files.reduce((n, f) => n + f.additions + f.deletions, 0);
  const dirs = new Set(files.map((f) => f.path.split("/").slice(0, 3).join("/")));
  const hot = HOTSPOTS.filter(([, re]) => files.some((f) => re.test(f.path))).map(([n]) => n);
  const tests = files.filter((f) => /test|spec|__tests__/.test(f.path)).length;
  // ponytail: additive heuristic; swap in real import-graph fan-out if this ever misleads
  const score = Math.min(100, Math.min(35, files.length * 3) + Math.min(30, lines / 25) + Math.min(35, hot.length * 12));
  return { score: Math.round(score), files: files.length, lines, dirs: dirs.size, hotspots: hot, testFiles: tests };
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
      body: JSON.stringify({ model: c.model, max_tokens: 16000, messages: [{ role: "user", content: prompt }] }),
      signal: AbortSignal.timeout(180000),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const msg = await res.json();
    if (msg.stop_reason === "refusal") throw new Error(`Anthropic declined the request (${msg.stop_details?.category || "refusal"})`);
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

const REVIEW_DEFAULTS = { maxFindings: 8, diffChars: 90000, temperature: 0.2, postScores: false, postReview: false, postInlineSuggestions: false };
const reviewConfig = async () => ({ ...REVIEW_DEFAULTS, ...((await store.getSetting("review")) || {}) });

// Repository review guides: AGENTS.md and/or CLAUDE.md at the repo root (both are used when both exist, since one is
// often a stub pointing at the other). Detection is cached for 10 minutes; whether guides are used is a per-repository
// setting ("guides": { "owner/name": { use: bool } }), defaulting to on when found.
const GUIDE_FILES = ["AGENTS.md", "CLAUDE.md"];
const GUIDE_CHARS = 20000;
const guideCache = new Map();
function guideFiles(repo, ref = "") {
  const cacheKey = `${repo}@${ref}`;
  const hit = guideCache.get(cacheKey);
  if (hit && Date.now() - hit.at < 600e3) return hit.files;
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
const guideText = (repo, file, ref = "") => {
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
async function guideFor(repo, ref = "") {
  const files = guideFiles(repo, ref);
  if (!files.length) return null;
  const use = (await store.getSetting("guides"))?.[repo]?.use ?? true;
  if (!use) return null;
  const per = Math.floor(GUIDE_CHARS / files.length);
  return { file: files.join(" + "), text: files.map((f) => `--- ${f} ---\n${guideText(repo, f, ref).slice(0, per)}`).join("\n\n") };
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
    const raw = await ghAsync("api", `repos/${repo}/commits?sha=${encodeURIComponent(pr.baseRefName)}&per_page=8`);
    const list = JSON.parse(raw);
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
    const issueRepo = repoCandidate ? String(repoCandidate).trim() : baseRepo;
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
        const raw = await ghAsync(["issue", "view", String(num), "-R", issueRepo, "--json", "number,title,body,state,url,labels"]).catch(() =>
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
          url: String(iss.url || `https://github.com/${issueRepo}/issues/${num}`),
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
function s1State(pr, diff, c, guide = null, gitHistory = null, linkedIssues = [], learnings = [], incrementalCtx = null) {
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
    change_facts: (({ files, lines, dirs, hotspots, testFiles }) => ({ files, lines, areas: dirs, sensitive_areas: hotspots, test_files: testFiles }))(blastRadius(pr.files)),
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
    ...(gitHistory?.formatted ? { git_change_history: gitHistory.formatted.slice(0, 4000) } : {}),
    diff: diff.slice(0, c.contextChars || 80000),
  };
}
async function scoreWithSystemOne(pr, diff, c, guide, onPartial, gitHistory, linkedIssues = [], learnings = [], incrementalCtx = null) {
  const state = s1State(pr, diff, c, guide, gitHistory, linkedIssues, learnings, incrementalCtx);
  const questions = {};
  for (const [k, levels] of Object.entries(S1_SCORES)) questions[`score_${k}`] = { type: "score", instructions: `Rate the pull request's ${k.replace("_", " ")}.`, criteria: levels };
  for (const g of S1_GATES) if ((!g.needsGuide || guide) && (!g.needsIssues || linkedIssues?.length)) questions[`gate_${g.id}`] = { type: "noul", instructions: g.q };
  const a = await askSystemOne(state, questions, c, onPartial ? (partial) => {
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
  const scores = Object.fromEntries(Object.keys(S1_SCORES).map((k) => [k, Math.max(0, Math.min(100, Math.round((Number(a[`score_${k}`]?.score) || 0) / 4 * 100)))]));
  const gates = S1_GATES.filter((g) => a[`gate_${g.id}`]).map((g) => { const yes = Number(a[`gate_${g.id}`].noul) || 0; return { id: g.id, label: g.label, yes: Math.round(yes * 100) / 100, pass: g.risk ? yes < 0.5 : yes >= 0.5 }; });
  onPartial?.({ readyScores: scores, gates, done: true });
  return { scores, gates };
}

// Unified diff -> [{ file, header, diff }] hunks, largest first, capped. CodeReviewer reads one hunk at a time (512 tokens).
function splitHunks(diff, maxHunks = 40, maxChars = 2000) {
  const out = [];
  let file = "";
  let cur = null;
  const push = () => { if (cur && cur.diff.trim()) out.push(cur); cur = null; };
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git")) { push(); file = (line.match(/ b\/(.+)$/) || [])[1] || file; continue; }
    if (line.startsWith("+++ ")) { file = line.slice(4).replace(/^b\//, "") || file; continue; }
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

  return {
    file,
    ...(line > 0 ? { line } : {}),
    severity,
    title,
    detail,
    ...(suggestion ? { suggestion: str(suggestion, 2000) } : {}),
    ...(f?.dismissed ? { dismissed: true } : {}),
  };
}

function prompt(pr, diff, c, r = REVIEW_DEFAULTS, guide = null, wantScores = true, gitHistory = null, linkedIssues = [], learnings = [], incrementalCtx = null) {
  const issueBlock = linkedIssues?.length
    ? `\nLinked GitHub Issues & Requirements (MANDATORY: explicitly verify whether the pull request diff fulfills all requirements and acceptance criteria described in these linked issues, and flag any unfulfilled or partially met requirement in findings):\n${linkedIssues
        .map((iss) => `Issue #${iss.number} (${iss.repo}, ${iss.state}): ${iss.title}${iss.labels?.length ? ` [${iss.labels.join(", ")}]` : ""}\n${(iss.body || "(no body provided)").slice(0, 1200)}`)
        .join("\n\n")}\n`
    : "";
  const learningsBlock = learnings?.length
    ? `\nRepository Team Learnings (Never flag these dismissed patterns):\n${learnings.map((l) => `- ${l}`).join("\n")}\n`
    : "";
  const incrementalBlock = incrementalCtx?.promptBlock ? `\n${incrementalCtx.promptBlock}\n` : "";
  return `You are CodeOtter, a strict senior staff code reviewer. Review this pull request using the repository's review guidelines (AGENTS.md / CLAUDE.md), the repository team learnings, the linked GitHub issues and acceptance criteria, the git commit history, and the code diff. Reply with ONLY a JSON object:
{"summary":"3-5 sentence architectural walkthrough covering what changed, commit progression, fulfillment of linked issue requirements, and adherence to repository guidelines","verdict":"approve|comment|request_changes",
${wantScores ? ` "scores":{"quality":0-100,"correctness_risk":0-100 (100 = very risky),"test_coverage":0-100,"readability":0-100,"pr_hygiene":0-100 (title, description, scope, commit focus)},\n` : ""} "findings":[{"severity":"blocker|major|minor|nit|high|medium|low","file":"path","line":42,"title":"short","detail":"specific line/behaviour and fix (cite AGENTS.md/CLAUDE.md rule, linked issue #number requirement, or commit if relevant)","suggestion":"optional exact replacement code"}],
 "walkthrough":[{"file":"path","change":"concise summary of change in this file"}]}
For each finding, include the integer target \`line\` number in the new file and an optional \`suggestion\` containing the exact replacement code snippet for the target line/block (without markdown backticks) so the fix can be applied in one click. Be concrete; cite exact files and rules. Respect all Repository Team Learnings and never flag dismissed patterns. Max ${r.maxFindings} findings, most severe first. Today is ${new Date().toISOString().slice(0, 10)}.

PR #${pr.number}: ${pr.title}
Author: ${pr.author.login}  Base: ${pr.baseRefName} <- Head: ${pr.headRefName}${pr.headSha ? ` (${pr.headSha.slice(0, 7)})` : ""}  Files: ${pr.changedFiles}  +${pr.additions} -${pr.deletions}
Description:
${(pr.body || "(none)").slice(0, c.contextChars ? Math.min(3000, Math.floor(c.contextChars / 10)) : 3000)}
${incrementalBlock}${issueBlock}${learningsBlock}${gitHistory?.formatted ? `\nGit Change History (commits in this PR and recent target branch history):\n${gitHistory.formatted.slice(0, 4000)}\n` : ""}${guide ? `\nRepository Review Guidelines from ${guide.file} (MANDATORY: verify all code changes and commits against these rules and flag any violation in findings):\n${guide.text}\n` : ""}
Diff (may be truncated):
${diff.slice(0, Math.min(r.diffChars, c.contextChars || Infinity))}`;
}

async function judge(pr, diff, c, r = REVIEW_DEFAULTS, guide = null, wantScores = true, gitHistory = null, onProgress = null, linkedIssues = [], learnings = [], incrementalCtx = null) {
  if (c.api === "codereviewer") return reviewWithCodeReviewer(pr, diff, c, guide, gitHistory, onProgress, linkedIssues, learnings, incrementalCtx);
  const text = await askModel(prompt(pr, diff, c, r, guide, wantScores, gitHistory, linkedIssues, learnings, incrementalCtx), { ...c, temperature: r.temperature });
  let out;
  try {
    out = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  } catch {
    throw new Error("The model did not return valid JSON; try again or pick another model");
  }
  const n = (x) => Math.max(0, Math.min(100, Math.round(Number(x)) || 0));
  const str = (x, max) => String(x ?? "").slice(0, max);
  return {
    summary: str(out.summary, 2500),
    verdict: ["approve", "comment", "request_changes"].includes(out.verdict) ? out.verdict : "comment",
    scores: Object.fromEntries(["quality", "correctness_risk", "test_coverage", "readability", "pr_hygiene"].map((k) => [k, n(out.scores?.[k])])),
    findings: (Array.isArray(out.findings) ? out.findings : []).slice(0, 20).map((f) => deriveSuggestionFromDetail(f, diff)),
    walkthrough: (Array.isArray(out.walkthrough) ? out.walkthrough : []).slice(0, 100).filter((w) => w && typeof w.file === "string").map((w) => ({ file: str(w.file, 300), change: str(w.change, 500) })),
    rawOutput: str(text, 20000),
  };
}

// Onboarded repositories. Saved from the Repositories settings page; falls back to REPO (env or the repo launched from).
const repos = async () => {
  const saved = await store.getSetting("repos");
  return saved?.length ? saved : REPO ? [REPO] : [];
};
let ghReposCache;
function ghRepos(owner = "") {
  if (owner && !OWNER_RE.test(owner)) return [];
  ghReposCache ||= new Map();
  if (!ghReposCache.has(owner)) {
    try {
      ghReposCache.set(owner, JSON.parse(gh("repo", "list", ...(owner ? [owner] : []), "--limit", "100", "--json", "nameWithOwner")).map((r) => r.nameWithOwner));
    } catch {
      ghReposCache.set(owner, []);
    }
  }
  return ghReposCache.get(owner);
}

const activeReviews = new Map();

async function resolvePr(ref, repo) {
  if (!/^\d+$/.test(ref) && !PR_URL_RE.test(ref)) throw new Error("Paste a github.com pull request URL, or a number with a repository selected");
  if (repo && !REPO_RE.test(repo)) throw new Error(`Not an owner/name: ${repo}`);
  if (/^\d+$/.test(ref) && !repo) repo = (await repos())[0];
  if (/^\d+$/.test(ref) && !repo) throw new Error("Paste the full pull request URL, or add a repository first");
  const urlGuess = /^\d+$/.test(ref) ? `https://github.com/${repo}/pull/${ref}` : ref;
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
  const pr = cached?.pr || JSON.parse(await ghAsync("pr", "view", ...spec, "--json", "number,title,body,author,url,baseRefName,headRefName,headRefOid,additions,deletions,changedFiles,files,commits,state"));
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
      const [freshPrJson, diff, guide, learnings] = await Promise.all([
        cached?.pr ? ghAsync("pr", "view", ...spec, "--json", "number,title,body,author,url,baseRefName,headRefName,headRefOid,additions,deletions,changedFiles,files,commits,state").catch(() => null) : Promise.resolve(null),
        ghAsync("pr", "diff", ...spec),
        Promise.resolve().then(() => guideFor(repoOf(pr), pr.headRefName)),
        getRepoLearnings(repoOf(pr)),
      ]);
      if (freshPrJson) {
        live.pr = JSON.parse(freshPrJson);
        const fb = blastRadius(live.pr.files);
        const keepScore = !runScores || live.blast.source === "s1";
        live.blast = { ...fb, ...(keepScore ? { score: live.blast.score, source: live.blast.source || prevBlast?.source || "s1" } : {}) };
      }
      live.guide = guide?.file || null;
      live.learnings = learnings;
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
            const cmpRaw = await ghAsync("api", `repos/${repoOf(live.pr)}/compare/${encodeURIComponent(prevSha)}...${encodeURIComponent(currentHeadSha)}`).catch(() =>
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
      }

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
          }, gitHistory, linkedIssues, learnings, incrementalCtx)
        : Promise.resolve(null);

      const needLlmForScores = runScores && !s1.enabled;
      const llmTask = (runLlm || needLlmForScores) && llmReady
        ? judge(live.pr, diff, c, rc, guide, !s1.enabled, gitHistory, (partial) => {
            if (runLlm) {
              live.review = { ...live.review, ...partial, scores: live.review.scores };
            }
          }, linkedIssues, learnings, incrementalCtx).then((nav) => {
            const scores = (!runScores || s1.enabled)
              ? (hasValidScores(live.review.scores) ? live.review.scores : initialScores)
              : (hasValidScores(nav.scores) ? nav.scores : initialScores);
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
        blast: live.blast,
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
        ...(f.suggestion
          ? [
              "",
              "```suggestion",
              String(f.suggestion).replace(/\r?\n$/, ""),
              "```",
            ]
          : []),
      ];
      return {
        path: f.file,
        line: targetLine,
        side: "RIGHT",
        body: bodyLines.join("\n"),
        finding: f,
      };
    })
    .filter(Boolean);

  if (!comments.length) return { posted: 0, mode: "none", comments: [] };

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

async function syncPrComments(r, repo = repoOf(r.pr), { postScores = false, postReview = false, postInlineSuggestions = false } = {}) {
  if (!postScores && !postReview && !postInlineSuggestions) return [];
  let existingComments = [];
  try {
    const raw = await ghAsync(["api", `repos/${repo}/issues/${r.pr.number}/comments?per_page=100`]).catch(() =>
      gh(["api", `repos/${repo}/issues/${r.pr.number}/comments`]),
    );
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) existingComments = parsed;
  } catch {}

  const upsert = async (marker, body, label) => {
    const existing = existingComments.find((c) => typeof c?.body === "string" && c.body.includes(marker));
    if (existing?.id) {
      await ghAsync(["api", "--method", "PATCH", `repos/${repo}/issues/comments/${existing.id}`, "-f", `body=${body}`]).catch(() =>
        gh(["api", "--method", "PATCH", `repos/${repo}/issues/comments/${existing.id}`, "-f", `body=${body}`]),
      );
      return `${label} (updated)`;
    }
    await ghAsync("pr", "comment", r.pr.url, "--body", body).catch(() =>
      gh(["pr", "comment", r.pr.url, "--body", body]),
    );
    return label;
  };

  const posted = [];
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
const repoOf = (pr) => pr.url.split("/").slice(3, 5).join("/");
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

function openPrs(repo) {
  try {
    return JSON.parse(gh("pr", "list", "-R", repo, "--json", "number,title,author,url,updatedAt,additions,deletions,changedFiles", "--limit", "30"));
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
  const open = (await repos()).flatMap(openPrs)
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
    `<a class="btn" href="/score?pr=${encodeURIComponent(pr.url)}&force=1">Re-review</a><a class="btn pri" href="${pr.url}" style="text-decoration:none">Open in GitHub</a>`,
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
const MIME = { html: "text/html", js: "text/javascript", css: "text/css", svg: "image/svg+xml", png: "image/png", woff2: "font/woff2" };
// Settings are schema-driven: each page is { title, load() -> { sections, values }, save(body), test?() }.
// The server describes sections and fields as JSON; the UI has one generic renderer and a sidebar link per page.
// Field types: select, combo (select + free text), text, password, number, range, checkbox, readonly.
const mask = (secret) => (secret ? `\u2022\u2022\u2022\u2022${secret.slice(-4)}` : "");
const byProvider = (pick) => Object.fromEntries(Object.entries(PROVIDERS).map(([k, x]) => [k, pick(x)]));
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
      const items = list.map((r) => {
        const files = guideFiles(r); // real check at the repository root via the GitHub API
        const label = files.join(" + ");
        const g = guides[r] || {};
        const rs = repoSettings[r] || {};
        const postScores = g.postScores ?? rc.postScores;
        const postReview = g.postReview ?? rc.postReview;
        const postInlineSuggestions = g.postInlineSuggestions ?? rs.postInlineSuggestions ?? rc.postInlineSuggestions;
        const learnings = normalizeLearningList(rs.learnings ?? g.learnings ?? []);
        const settings = {
          title: r,
          fields: [
            files.length ? { key: "useGuides", label: "Auto-detected", type: "checkbox", text: label } : { key: "none", label: "Auto-detected", type: "readonly" },
            { key: "postScores", label: "Post scores on PR", type: "checkbox", text: "Add a comment to the PR with all System One scores" },
            { key: "postReview", label: "Add PR review as a comment", type: "checkbox", text: "Add the review summary and a link to the full report" },
            { key: "postInlineSuggestions", label: "Post inline suggestions", type: "checkbox", text: "Post inline committable suggestion comments on PR diff lines" },
            { key: "learnings", label: "Team learnings", type: "list", removable: true, hint: "Dismissed review findings remembered as persistent team rules for this repository." },
          ],
          values: {
            ...(files.length ? { useGuides: g.use ?? true } : { none: "none" }),
            postScores: !!postScores,
            postReview: !!postReview,
            postInlineSuggestions: !!postInlineSuggestions,
            learnings,
          },
        };
        const meta = [
          files.length ? label : "",
          postScores ? "Post scores" : "",
          postReview ? "Post review" : "",
          postInlineSuggestions ? "Inline suggestions" : "",
          learnings.length ? `${learnings.length} learning${learnings.length === 1 ? "" : "s"}` : "",
        ]
          .filter(Boolean)
          .join(" · ");
        return { id: r, label: r, meta: meta || undefined, settings };
      });
      const sections = [
        {
          id: "repos",
          title: "Onboarded repositories",
          description: "Pull requests from these repositories show up in Reviews and in the sidebar.",
          fields: [
            { key: "list", label: "Repositories", type: "list", hint: "The gear opens a repository's settings; the cross removes it (reviews already stored are kept)." },
            { key: "add", label: "Add repository", type: "combo", placeholder: "owner/name", options: ghRepos(org).filter((r) => !list.includes(r)).map((value) => ({ value, label: value })), hint: org ? `Suggestions are ${org} repositories your GitHub login can see; any owner/name works and switches to that organization.` : "Repositories your GitHub login can see, or type any owner/name." },
          ],
          actions: [{ id: "save", label: "Save" }],
        },
      ];
      return { sections, values: { repos: { list: items, add: "" } } };
    },
    async save(body, { org } = {}) {
      const v = body.repos;
      if (!v) return;
      const clean = (r) => String(r).trim().replace(/^https:\/\/github\.com\//, "").replace(/\/+$/, "");
      const add = clean(v.add || "");
      const listed = (v.list || []).map((it) => (typeof it === "string" ? { id: it } : it));
      const mine = [...new Set([...listed.map((it) => clean(it.id)), add].filter(Boolean))];
      for (const r of mine) if (!/^[\w.-]+\/[\w.-]+$/.test(r)) throw new Error(`Not an owner/name: ${r}`);
      if (org) for (const r of listed.map((it) => clean(it.id))) if (!r.startsWith(`${org}/`)) throw new Error(`${r} is not under ${org}`);
      // other organizations' repositories are untouched by a scoped save
      const others = org ? (await repos()).filter((r) => !r.startsWith(`${org}/`)) : [];
      const next = [...others, ...mine];
      if (add && !(v.list || []).map(clean).includes(add)) {
        try {
          gh("repo", "view", add, "--json", "nameWithOwner");
        } catch {
          throw new Error(`Cannot access ${add}: check the name and that gh is logged in`);
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
            { key: "provider", label: "Provider", type: "select", options: [{ value: "none", label: "None" }, ...Object.entries(S1_PROVIDERS).map(([value, x]) => ({ value, label: x.label, icon: providerIcon(value) }))] },
            { key: "model", label: "Model", type: "select", hideWhen: { field: "provider", in: ["none", ...localIds] }, hint: s1Live.length ? `${s1Live.length} models listed by ${S1_PROVIDERS[s1.provider].label}.` : "", optionsBy: { field: "provider", map: { none: [], ...Object.fromEntries(Object.entries(S1_PROVIDERS).map(([k, x]) => [k, x.models.map((value) => ({ value, label: value, icon: modelIcon(value, k) }))])), ...(s1Live.length ? { [s1.provider]: s1Live } : {}) } } },
            { key: "apiKey", label: "API key", type: "password", hideWhen: { field: "provider", in: ["none", ...localIds] }, hint: s1.apiKey ? `Saved key ${mask(s1.apiKey)}. Leave blank to keep it.` : s1.provider === "custom" ? "Optional." : "No key saved yet.", placeholder: mask(s1.apiKey) || "paste key", linkBy: { field: "provider", map: Object.fromEntries(Object.entries(S1_PROVIDERS).filter(([, x]) => x.keyUrl).map(([k, x]) => [k, { label: "Get a key", url: x.keyUrl }])) } },
            { key: "baseUrl", label: "Base URL", type: "text", hideWhen: { field: "provider", in: ["none", ...localIds] }, placeholder: "http://host:port", defaultBy: { field: "provider", map: { none: "", ...Object.fromEntries(Object.entries(S1_PROVIDERS).map(([k, x]) => [k, x.baseUrl])) } } },
            { key: "status", label: "Status", type: "readonly", hideWhen: { field: "provider", in: ["none", "jev", "jev_openrouter", "custom"] }, hint: s1.local ? "Download, switch or delete local models under Settings / Local models." : "" },
          ],
          actions: [{ id: "save", label: "Save" }, { id: "probe", label: "Test connection", variant: "outline", needsSaved: true }],
        },
        {
          id: "review",
          title: "Review",
          description: "How much the model reads, how many findings it returns, and what gets posted as PR comments.",
          fields: [
            { key: "maxFindings", label: "Max findings", type: "range", min: 3, max: 12, step: 1 },
            { key: "diffChars", label: "Diff sent to the model", type: "select", options: [30000, 60000, 90000, 150000, 300000].map((v) => ({ value: v, label: `${v / 1000}k characters` })), hint: "Larger diffs cost more and may exceed the model's context." },
            { key: "temperature", label: "Temperature", type: "range", min: 0, max: 1, step: 0.1, hint: "Ignored by Anthropic models, which do not take sampling parameters." },
            { key: "postScores", label: "Post scores on PR", type: "checkbox", text: "Add a GitHub PR comment with all System One scores after review" },
            { key: "postReview", label: "Add PR review as a comment", type: "checkbox", text: "Add a GitHub PR comment with the review summary and link to the full report" },
            { key: "postInlineSuggestions", label: "Post inline suggestions", type: "checkbox", text: "Post inline committable suggestion comments on PR diff lines" },
          ],
          actions: [{ id: "save", label: "Save" }],
        },
      ];
      return { sections, values: { llm: { provider: c.provider, model: c.model, apiKey: "", baseUrl: c.baseUrl, llmStatus: c.local ? localStatus(c.local).text : "" }, s1: { provider: s1.provider, model: s1.model, apiKey: "", baseUrl: s1.baseUrl, status: s1.local ? localStatus(s1.local).text : "" }, review: r } };
    },
    async save(body) {
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
          temperature: Math.min(1, Math.max(0, Number(v.temperature) || 0)),
          postScores: !!v.postScores,
          postReview: !!v.postReview,
          postInlineSuggestions: !!v.postInlineSuggestions,
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
      if (!PB_URL) return { sections: [{ id: "oauth", title: "GitHub", description: "Sign-in is not available in file-storage mode. Start with PB_URL set (the Docker image does).", fields: [] }], values: {} };
      const o = await store.getOAuth();
      const gh = o.providers.find((x) => x.name === "github") || {};
      const redirect = `${APP_URL}/auth/callback`;
      const sections = [
        {
          id: "oauth",
          title: "GitHub",
          fields: [
            { key: "status", label: "Status", type: "readonly" },
            { key: "provider", label: "Provider", type: "select", options: [{ value: "github", label: "GitHub" }] },
            { key: "enabled", label: "Enabled", type: "checkbox", hint: "Turn on once the client id and secret are saved." },
            { key: "clientId", label: "Client ID", type: "text", link: { label: "Create a GitHub OAuth app", url: "https://github.com/settings/developers" } },
            { key: "clientSecret", label: "Client secret", type: "password", hint: gh.clientId ? "A secret is stored with the client id above. Leave blank to keep it." : "No secret saved yet.", placeholder: gh.clientId ? "••••••••" : "paste secret" },
            { key: "redirectUrl", label: "Callback URL", type: "readonly", hint: "Paste this as the Authorization callback URL in the GitHub OAuth app. Set APP_URL when the app runs behind a domain." },
          ],
          // The one-click creator only shows while nothing is connected yet.
          actions: [{ id: "save", label: "Save" }, ...(gh.clientId ? [] : [{ id: "connect", label: "Create GitHub app for me", variant: "outline", always: true }])],
        },
      ];
      const status = !gh.clientId ? "Not connected" : o.enabled ? `Connected · client id ${gh.clientId}` : `Configured but disabled · client id ${gh.clientId}`;
      return { sections, values: { oauth: { status, provider: "github", enabled: !!o.enabled, clientId: gh.clientId || "", clientSecret: "", redirectUrl: redirect } } };
    },
    // GitHub App manifest flow: the browser posts a manifest to GitHub, the user clicks Create once, GitHub returns a
    // code to /github/manifest/callback, and the conversion gives us the client id + secret to store in PocketBase.
    actions: {
      async connect(req, res) {
        if (!PB_URL) throw new Error("Sign-in is not available in file-storage mode (set PB_URL)");
        const state = randomBytes(16).toString("hex");
        setCookie(res, "pr_manifest", state, 600);
        const owner = ((await repos())[0] || "pr-scorer").split("/")[0].toLowerCase().replace(/[^a-z0-9-]/g, "-");
        const manifest = {
          name: `pr-scorer-${owner}`.slice(0, 29) + "-" + Math.random().toString(36).slice(2, 6),
          url: APP_URL,
          redirect_url: `${APP_URL}/github/manifest/callback`,
          callback_urls: [`${APP_URL}/auth/callback`],
          public: false,
          default_permissions: { emails: "read" },
          request_oauth_on_install: false,
        };
        return { submit: { url: `https://github.com/settings/apps/new?state=${state}`, fields: { manifest: JSON.stringify(manifest) } } };
      },
    },
    async save(body) {
      if (!PB_URL) throw new Error("Sign-in is not available in file-storage mode (set PB_URL)");
      const v = body.oauth;
      if (!v) return;
      // PocketBase never returns the secret and keeps the stored one when the PATCH omits it, so only send what was typed.
      const o = await store.getOAuth();
      const clientId = v.clientId || "";
      const provider = { name: "github", clientId, ...(v.clientSecret ? { clientSecret: v.clientSecret } : {}) };
      await store.setOAuth({ ...o, enabled: !!v.enabled && !!clientId, providers: clientId ? [provider] : [] });
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
    return { sections: [{ id: "accounts", title: "Accounts", fields: [{ key: "list", label: "Accounts", type: "list", removable: false, hint: "Gear sets the role. Sign-in with GitHub creates accounts; the first one is the owner." }], actions: [{ id: "save", label: "Save" }] }], values: { accounts: { list: items } } };
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
  const open = rs.flatMap(openPrs);
  const waiting = open.filter((p) => !done.has(p.url));
  const c = await llmConfig();
  const week = all.filter((r) => Date.now() - Date.parse(r.at) < 7 * 864e5);
  const changes = all.filter((r) => r.review.verdict === "request_changes").length;
  const perRepo = (repo) => {
    const mine = all.filter((r) => repoOf(r.pr) === repo);
    const wait = waiting.filter((p) => repoOf(p) === repo).length;
    return [
      { text: repo, path: `/repo/${repo}` },
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
        repoOf(r.pr),
        VERDICT_CELL[r.review.verdict] || VERDICT_CELL.comment,
        r.review.scores.quality,
        r.blast.score,
        new Date(r.at).toLocaleDateString(undefined, { day: "numeric", month: "short" }),
      ]) },
    { id: "links", kind: "links", title: "Quick links", items: [
      { label: "Repositories", hint: "Add or remove onboarded repositories", path: "/settings/repos" },
      { label: "Sign-in (OAuth)", hint: "GitHub login", path: "/settings/oauth" },
      { label: "Documentation", hint: "README on GitHub", href: "https://github.com/dharmeshgurnani/CodeOtter#readme" },
    ] },
  ];
  return { sections };
}
// Cookies: pr_oauth holds the in-flight state + PKCE verifier, pr_auth the PocketBase user token.
const cookies = (req) => Object.fromEntries((req.headers.cookie || "").split(";").map((c) => c.trim().split("=")).filter(([k]) => k).map(([k, ...v]) => { try { return [k, decodeURIComponent(v.join("="))]; } catch { return [k, ""]; } }));
const safeJson = (text) => { try { return JSON.parse(text); } catch { return null; } };
const setCookie = (res, name, value, maxAge) => {
  const prev = res.getHeader("set-cookie") || [];
  res.setHeader("set-cookie", [...(Array.isArray(prev) ? prev : [prev]), `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${APP_URL.startsWith("https") ? "; Secure" : ""}`]);
};
// Account types. owner: everything. admin: everything except Accounts and sign-in configuration. developer: reserved.
// The first account to sign in becomes owner; later ones admin. Until any account exists, an anonymous visitor
// is treated as owner so the instance can be set up (bootstrap); once an owner exists, anonymous gets no settings.
const ROLES = ["owner", "admin"];
const userView = (rec) => ({ id: rec.id, name: rec.name || rec.username || rec.email?.split("@")[0] || "GitHub user", email: rec.email || "", role: rec.role || "", avatar: rec.avatar ? `/api/me/avatar?id=${rec.id}&f=${encodeURIComponent(rec.avatar)}` : "" });
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
        return json({ repo: rs[0] || "", repos: rs, model: `${c.provider}/${c.model}`, baseUrl: c.baseUrl, store: PB_URL ? "pocketbase" : "files", settingsPages: await settingsPages(g.user), reviewed: await store.all(), open: rs.flatMap(openPrs) });
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
        let configured = false;
        if (PB_URL) { try { const m = await store.authMethods(); configured = !!m.oauth2?.enabled && m.oauth2.providers.some((x) => x.name === "github"); } catch {} }
        return json({ showcase, signInAvailable: !!PB_URL, configured });
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
        const gh = m.oauth2?.enabled && m.oauth2.providers.find((p) => p.name === "github");
        if (!gh) throw new Error("GitHub sign-in is not configured: open Settings / OAuth");
        const back = url.searchParams.get("back") || "/";
        setCookie(res, "pr_oauth", JSON.stringify({ state: gh.state, codeVerifier: gh.codeVerifier, back: /^\/(?![\/\\])/.test(back) ? back : "/" }), 600);
        return json({ url: gh.authURL + encodeURIComponent(`${APP_URL}/auth/callback`) });
      }
      if (url.pathname === "/auth/callback") {
        const flow = safeJson(cookies(req).pr_oauth || "null");
        const fail = (msg) => { res.statusCode = 302; res.setHeader("location", `/login?login_error=${encodeURIComponent(msg)}`); return res.end(); };
        if (!flow || flow.state !== url.searchParams.get("state")) return fail("Sign-in state mismatch, try again");
        if (url.searchParams.get("error")) return fail(url.searchParams.get("error_description") || url.searchParams.get("error"));
        let auth;
        try {
          auth = await store.authWithOAuth2({ provider: "github", code: url.searchParams.get("code"), codeVerifier: flow.codeVerifier, redirectURL: `${APP_URL}/auth/callback` });
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
        const fail = (msg) => { res.statusCode = 302; res.setHeader("location", `/settings/oauth?error=${encodeURIComponent(msg)}`); return res.end(); };
        if (!cookies(req).pr_manifest || cookies(req).pr_manifest !== url.searchParams.get("state")) return fail("GitHub app creation state mismatch, try again");
        const conv = await fetch(`https://api.github.com/app-manifests/${encodeURIComponent(url.searchParams.get("code"))}/conversions`, { method: "POST", headers: { accept: "application/vnd.github+json", "user-agent": "pr-scorer" } });
        if (!conv.ok) return fail(`GitHub rejected the app manifest (${conv.status})`);
        const app = await conv.json();
        const o = await store.getOAuth();
        await store.setOAuth({ ...o, enabled: true, providers: [{ name: "github", clientId: app.client_id, clientSecret: app.client_secret }] });
        setCookie(res, "pr_manifest", "", 0);
        res.statusCode = 302;
        res.setHeader("location", `/settings/oauth?connected=${encodeURIComponent(app.html_url || app.slug || "")}`);
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
        const repo = String(body.repo || (prUrl ? prUrl.split("/").slice(3, 5).join("/") : "")).trim();
        if (!repo || !REPO_RE.test(repo)) throw new Error("Invalid repository");
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
        if (prUrl && PR_URL_RE.test(prUrl)) {
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
      if (url.pathname === "/api/review-suggestions" && req.method === "POST") {
        const g = await gate(req, res, "admin");
        if (!g.ok) return;
        const body = await readJson(req);
        const prUrl = String(body.prUrl || "").trim();
        if (!prUrl || !PR_URL_RE.test(prUrl)) throw new Error("Invalid pull request URL");
        const repo = String(body.repo || prUrl.split("/").slice(3, 5).join("/")).trim();
        if (!repo || !REPO_RE.test(repo)) throw new Error("Invalid repository");
        const prNumMatch = prUrl.match(/\/pull\/(\d+)$/);
        const prNum = prNumMatch ? Number(prNumMatch[1]) : 0;
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
      if (url.pathname === "/api/score" || (url.pathname === "/score" && url.searchParams.get("pr"))) {
        if (!(await gate(req, res)).ok) return;
        const ref = (url.searchParams.get("pr") || "").trim();
        if (!ref) throw new Error("Missing pr");
        const force = url.searchParams.has("force");
        const repo = url.searchParams.get("repo") || "";
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
        res.setHeader("content-type", "image/svg+xml; charset=utf-8");
        res.setHeader("cache-control", "public, max-age=86400");
        return res.end(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🦦</text></svg>`);
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
        return res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="#0d1117"/><rect x="48" y="48" width="1104" height="534" rx="24" fill="#161b22" stroke="#30363d" stroke-width="2"/><text x="96" y="150" font-size="52">🦦</text><text x="168" y="146" fill="#f0f6fc" font-family="Inter,system-ui,sans-serif" font-size="38" font-weight="700">CodeOtter</text><text x="96" y="280" fill="#ffffff" font-family="Inter,system-ui,sans-serif" font-size="46" font-weight="700">${esc(ogTitle)}</text><text x="96" y="355" fill="#8b949e" font-family="ui-monospace,SFMono-Regular,Consolas,monospace" font-size="25">${esc(ogSub)}</text><text x="96" y="510" fill="#f59e0b" font-family="Inter,system-ui,sans-serif" font-size="22" font-weight="600">AI Pull Request Review · Blast Radius · Merge Gates</text></svg>`);
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
          pageDesc = "Sign in with GitHub to access CodeOtter AI pull request reviews, blast radius metrics, and merge gates.";
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
      json({ error: e.message });
    }
  })
  .setTimeout(0) // Node cuts requests at 300 s by default; a cold local sidecar plus a long review can take longer
  .listen(PORT, async () => console.log(`CodeOtter on http://localhost:${PORT} (repo ${REPO}, model ${(await llmConfig()).model}, store ${PB_URL ? `PocketBase ${PB_URL}` : "scores/"})`));
