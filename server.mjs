// pr-scorer: zero-dependency PR quality + blast-radius scorer. `node server.mjs` then open http://localhost:4747
import http from "node:http";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
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
// Providers. Everything except Anthropic speaks the OpenAI chat/completions shape.
const PROVIDERS = {
  anthropic: { label: "Anthropic", api: "anthropic", baseUrl: "https://api.anthropic.com", models: ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"], keyEnv: "ANTHROPIC_API_KEY", keyUrl: "https://console.anthropic.com/settings/keys" },
  openai: { label: "OpenAI (ChatGPT)", api: "openai", baseUrl: "https://api.openai.com/v1", models: ["gpt-5", "gpt-5-mini", "gpt-4.1"], keyEnv: "OPENAI_API_KEY", keyUrl: "https://platform.openai.com/api-keys" },
  minimax: { label: "MiniMax", api: "openai", baseUrl: "https://api.minimax.io/v1", models: ["MiniMax-M3", "MiniMax-M2.5"], keyEnv: "MINIMAX_API_KEY", keyUrl: "https://platform.minimax.io/user-center/basic-information/interface-key" },
  openrouter: { label: "OpenRouter", api: "openai", baseUrl: "https://openrouter.ai/api/v1", models: ["anthropic/claude-sonnet-5", "openai/gpt-5", "qwen/qwen3-coder", "deepseek/deepseek-chat"], keyEnv: "OPENROUTER_API_KEY", keyUrl: "https://openrouter.ai/keys" },
  ollama: { label: "Ollama (local)", api: "openai", baseUrl: "http://localhost:11434/v1", models: ["qwen2.5-coder:latest", "deepseek-coder-v2:latest", "llama3.1:latest"], noKey: true },
  custom: { label: "Custom OpenAI-compatible", api: "openai", baseUrl: "", models: [] },
};
// Defaults come from env (LLM_* keeps working); the Settings page overrides them and persists to the store.
const ENV_DEFAULTS = process.env.LLM_BASE_URL
  ? { provider: "custom", baseUrl: process.env.LLM_BASE_URL, model: process.env.LLM_MODEL || "", apiKey: process.env.LLM_API_KEY || "" }
  : { provider: "minimax", baseUrl: PROVIDERS.minimax.baseUrl, model: process.env.LLM_MODEL || "MiniMax-M3", apiKey: process.env.LLM_API_KEY || "" };
async function llmConfig() {
  const saved = (await store.getSetting("llm")) || {};
  const provider = saved.provider || ENV_DEFAULTS.provider;
  const p = PROVIDERS[provider] || PROVIDERS.custom;
  const isEnv = provider === ENV_DEFAULTS.provider;
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
  if (!res.ok) throw new Error(`PocketBase ${res.status}: ${pbError(await res.text())}`);
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
const gh = (...args) => {
  try {
    return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    throw new Error(`gh ${args.slice(0, 2).join(" ")}: ${String(e.stderr || e.message).trim().split("\n")[0] || "failed"}`);
  }
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
  if (!c.apiKey && !PROVIDERS[c.provider]?.noKey && !/localhost|127\.0\.0\.1/.test(c.baseUrl)) throw new Error(`No API key for ${PROVIDERS[c.provider]?.label || c.provider}: open Settings`);
  const base = c.baseUrl.replace(/\/+$/, "");
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
    signal: AbortSignal.timeout(180000),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()).choices[0].message.content.replace(/<think>[\s\S]*?<\/think>/g, "");
}

const REVIEW_DEFAULTS = { maxFindings: 8, diffChars: 90000, temperature: 0.2 };
const reviewConfig = async () => ({ ...REVIEW_DEFAULTS, ...((await store.getSetting("review")) || {}) });

// Repository review guides: AGENTS.md and/or CLAUDE.md at the repo root (both are used when both exist, since one is
// often a stub pointing at the other). Detection is cached for 10 minutes; whether guides are used is a per-repository
// setting ("guides": { "owner/name": { use: bool } }), defaulting to on when found.
const GUIDE_FILES = ["AGENTS.md", "CLAUDE.md"];
const GUIDE_CHARS = 20000;
const guideCache = new Map();
function guideFiles(repo) {
  const hit = guideCache.get(repo);
  if (hit && Date.now() - hit.at < 600e3) return hit.files;
  const files = GUIDE_FILES.filter((f) => {
    try {
      gh("api", `repos/${repo}/contents/${f}`, "--jq", ".name");
      return true;
    } catch {
      return false;
    }
  });
  guideCache.set(repo, { files, at: Date.now() });
  return files;
}
const guideText = (repo, file) => gh("api", `repos/${repo}/contents/${file}`, "-H", "Accept: application/vnd.github.raw");
async function guideFor(repo) {
  const files = guideFiles(repo);
  if (!files.length) return null;
  const use = (await store.getSetting("guides"))?.[repo]?.use ?? true;
  if (!use) return null;
  const per = Math.floor(GUIDE_CHARS / files.length);
  return { file: files.join(" + "), text: files.map((f) => `--- ${f} ---\n${guideText(repo, f).slice(0, per)}`).join("\n\n") };
}

async function judge(pr, diff, c, r = REVIEW_DEFAULTS, guide = null) {
  const prompt = `You are a strict senior code reviewer. Review this pull request and reply with ONLY a JSON object:
{"summary":"2-3 sentence walkthrough","verdict":"approve|comment|request_changes",
 "scores":{"quality":0-100,"correctness_risk":0-100 (100 = very risky),"test_coverage":0-100,"readability":0-100,"pr_hygiene":0-100 (title, description, scope, commit focus)},
 "findings":[{"file":"path","severity":"high|medium|low|nit","title":"short","detail":"why + what to do"}],
 "walkthrough":[{"file":"path","change":"one line"}]}
Be concrete; cite files. Max ${r.maxFindings} findings, most severe first. Today is ${new Date().toISOString().slice(0, 10)}.

PR #${pr.number}: ${pr.title}
Author: ${pr.author.login}  Base: ${pr.baseRefName}  Files: ${pr.changedFiles}  +${pr.additions} -${pr.deletions}
Description:
${(pr.body || "(none)").slice(0, 3000)}
${guide ? `\nRepository review guidelines from ${guide.file} (follow these; flag violations as findings):\n${guide.text}\n` : ""}
Diff (may be truncated):
${diff.slice(0, r.diffChars)}`;
  const text = await askModel(prompt, { ...c, temperature: r.temperature });
  let out;
  try {
    out = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  } catch {
    throw new Error("The model did not return valid JSON; try again or pick another model");
  }
  const n = (x) => Math.max(0, Math.min(100, Math.round(Number(x)) || 0));
  const str = (x, max) => String(x ?? "").slice(0, max);
  const SEV = ["high", "medium", "low", "nit"];
  return {
    summary: str(out.summary, 2000),
    verdict: ["approve", "comment", "request_changes"].includes(out.verdict) ? out.verdict : "comment",
    scores: Object.fromEntries(["quality", "correctness_risk", "test_coverage", "readability", "pr_hygiene"].map((k) => [k, n(out.scores?.[k])])),
    findings: (Array.isArray(out.findings) ? out.findings : []).slice(0, 20).map((f) => ({ file: str(f?.file, 300), severity: SEV.includes(f?.severity) ? f.severity : "low", title: str(f?.title, 300), detail: str(f?.detail, 4000) })),
    walkthrough: (Array.isArray(out.walkthrough) ? out.walkthrough : []).slice(0, 100).filter((w) => w && typeof w.file === "string").map((w) => ({ file: str(w.file, 300), change: str(w.change, 500) })),
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

async function score(ref, force, repo) {
  if (!/^\d+$/.test(ref) && !PR_URL_RE.test(ref)) throw new Error("Paste a github.com pull request URL, or a number with a repository selected");
  if (repo && !REPO_RE.test(repo)) throw new Error(`Not an owner/name: ${repo}`);
  if (/^\d+$/.test(ref) && !repo) repo = (await repos())[0];
  if (/^\d+$/.test(ref) && !repo) throw new Error("Paste the full pull request URL, or add a repository first");
  const spec = /^\d+$/.test(ref) ? ["-R", repo, ref] : [ref];
  const pr = JSON.parse(gh("pr", "view", ...spec, "--json", "number,title,body,author,url,baseRefName,headRefName,additions,deletions,changedFiles,files,state"));
  if (!force) {
    const cached = await store.get(pr.url);
    if (cached) return cached;
  }
  const diff = gh("pr", "diff", ...spec);
  const c = await llmConfig();
  const guide = await guideFor(repoOf(pr));
  const result = { pr, blast: blastRadius(pr.files), review: await judge(pr, diff, c, await reviewConfig(), guide), model: `${c.provider}/${c.model}`, guide: guide?.file || null, at: new Date().toISOString() };
  await store.put(result);
  return result;
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
  const actionable = v.findings.filter((f) => f.severity !== "nit");
  const nits = v.findings.filter((f) => f.severity === "nit");
  const finding = (f) => {
    const [ic, kind, sev] = KIND[f.severity] || KIND.low;
    return `<div class="fnd"><div class="fh"><code>${esc(f.file)}</code></div><div class="fb"><b>${ic} ${kind}${sev ? `<span class="sev">| 🔴 ${sev}</span>` : ""}</b><b style="font-weight:600">${esc(f.title)}</b><span>${esc(f.detail)}</span></div></div>`;
  };
  const when = new Date(r.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  return page(
    `Reviews / #${pr.number}`,
    `<a class="btn" href="/score?pr=${encodeURIComponent(pr.url)}&force=1">Re-review</a><a class="btn pri" href="${pr.url}" style="text-decoration:none">Open in GitHub</a>`,
    `<h3>${esc(pr.title)} <span class="pill ${vt}">${vl}</span></h3>
    <p class="mut" style="margin:0 0 18px">${esc(repoOf(pr))} &middot; ${esc(pr.author.login)} wants to merge <code>${esc(pr.headRefName)}</code> into <code>${esc(pr.baseRefName)}</code> &middot; ${pr.changedFiles} files changed <span style="color:var(--ok)">+${pr.additions}</span> <span style="color:var(--bad)">-${pr.deletions}</span></p>

    <div class="cmt"><div class="hd"><span class="bot"></span><b>pr-scorer</b><span class="mut">bot commented ${esc(when)}</span></div><div class="bd">
      <h4 style="margin-top:0">Walkthrough</h4><p>${esc(v.summary)}</p>
      <h4>Changes</h4><table class="md"><tr><th style="width:38%">Cohort / File(s)</th><th>Summary</th></tr>${cohorts(v.walkthrough || [])}</table>
      <h4>Estimated code review effort</h4><p>🎯 ${e.n} (${e.label}) | ⏱️ ~${e.mins} minutes</p>
      <h4>Scores</h4><div class="rings">
        ${[["Quality", v.scores.quality], ["Blast radius", blast.score, 1], ["Risk", v.scores.correctness_risk, 1], ["Tests", v.scores.test_coverage], ["Readability", v.scores.readability], ["PR hygiene", v.scores.pr_hygiene]]
          .map(([l, n, inv]) => `<div class="ring ${tone(n, inv)}" style="--v:${n}"><b>${n}</b><span>${l}</span></div>`).join("")}
      </div>
      <details><summary>Blast radius details</summary><p>${blast.files} files &middot; ${blast.lines} lines &middot; ${blast.dirs} areas &middot; ${blast.testFiles} test files</p>${blast.hotspots.map((h) => `<span class="tag">${esc(h)}</span>`).join("") || "<span class=mut>No hotspots touched.</span>"}</details>
      <details><summary>Pre-merge checks</summary><table class="md"><tr><th>Check</th><th>Status</th></tr>
        <tr><td>Title check</td><td>${v.scores.pr_hygiene >= 60 ? "✅ Passed" : "⚠️ Warning"}</td></tr>
        <tr><td>Description check</td><td>${(pr.body || "").length > 80 ? "✅ Passed" : "⚠️ Warning"}</td></tr>
        <tr><td>Tests touched</td><td>${blast.testFiles ? "✅ Passed" : "⚠️ Warning"}</td></tr></table></details>
      <div class="ft"><span>Model ${esc(r.model)}</span><span>Reviewed ${esc(when)}</span></div>
    </div></div>

    <div class="cmt"><div class="hd"><span class="bot"></span><b>pr-scorer</b><span class="mut">bot reviewed ${esc(when)}</span></div><div class="bd">
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
      const guides = (await store.getSetting("guides")) || {};
      const items = list.map((r) => {
        const files = guideFiles(r); // real check at the repository root via the GitHub API
        const label = files.join(" + ");
        const settings = {
          title: r,
          fields: [files.length ? { key: "useGuides", label: "Auto-detected", type: "checkbox", text: label } : { key: "none", label: "Auto-detected", type: "readonly" }],
          values: files.length ? { useGuides: guides[r]?.use ?? true } : { none: "none" },
        };
        return { id: r, label: r, meta: files.length ? label : undefined, settings };
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
      const guides = (await store.getSetting("guides")) || {};
      for (const it of listed) if (it.settings && "useGuides" in (it.settings.values || {})) guides[clean(it.id)] = { use: !!it.settings.values.useGuides };
      for (const k of Object.keys(guides)) if (!next.includes(k)) delete guides[k];
      await store.setSetting("guides", guides);
    },
  },
  model: {
    title: "Model provider",
    group: "settings",
    access: "admin",
    async load() {
      const c = await llmConfig();
      const r = await reviewConfig();
      const p = PROVIDERS[c.provider] || PROVIDERS.custom;
      const sections = [
        {
          id: "llm",
          title: "Provider",
          description: "Which model reviews pull requests. Applies to the next review, no restart.",
          fields: [
            { key: "provider", label: "Provider", type: "select", options: Object.entries(PROVIDERS).map(([value, x]) => ({ value, label: x.label })) },
            { key: "model", label: "Model", type: "combo", hint: "Pick one or type any model id the provider accepts.", optionsBy: { field: "provider", map: byProvider((x) => x.models) } },
            { key: "apiKey", label: "API key", type: "password", hint: c.apiKey ? `Saved key ${mask(c.apiKey)}. Leave blank to keep it.` : p.noKey ? "" : "No key saved yet.", placeholder: mask(c.apiKey) || "paste key", hideWhen: { field: "provider", in: Object.keys(PROVIDERS).filter((k) => PROVIDERS[k].noKey) }, linkBy: { field: "provider", map: Object.fromEntries(Object.entries(PROVIDERS).filter(([, x]) => x.keyUrl).map(([k, x]) => [k, { label: "Get a key", url: x.keyUrl }])) } },
            { key: "baseUrl", label: "Base URL", type: "text", hint: "Prefilled per provider. Change only for proxies or self-hosted gateways.", defaultBy: { field: "provider", map: byProvider((x) => x.baseUrl) } },
          ],
          actions: [{ id: "save", label: "Save" }, { id: "test", label: "Test connection", variant: "outline", needsSaved: true }],
        },
        {
          id: "review",
          title: "Review",
          description: "How much the model reads and how many findings it returns.",
          fields: [
            { key: "maxFindings", label: "Max findings", type: "range", min: 3, max: 12, step: 1 },
            { key: "diffChars", label: "Diff sent to the model", type: "select", options: [30000, 60000, 90000, 150000, 300000].map((v) => ({ value: v, label: `${v / 1000}k characters` })), hint: "Larger diffs cost more and may exceed the model's context." },
            { key: "temperature", label: "Temperature", type: "range", min: 0, max: 1, step: 0.1, hint: "Ignored by Anthropic models, which do not take sampling parameters." },
          ],
          actions: [{ id: "save", label: "Save" }],
        },
      ];
      return { sections, values: { llm: { provider: c.provider, model: c.model, apiKey: "", baseUrl: c.baseUrl }, review: r } };
    },
    async save(body) {
      if (body.llm) {
        const v = body.llm;
        if (!PROVIDERS[v.provider]) throw new Error(`Unknown provider ${v.provider}`);
        const prev = (await store.getSetting("llm")) || {};
        const apiKey = v.apiKey || (prev.provider === v.provider && (v.baseUrl || "") === (prev.baseUrl || "") ? prev.apiKey : "") || "";
        await store.setSetting("llm", { provider: v.provider, model: v.model || "", baseUrl: v.baseUrl || "", apiKey });
      }
      if (body.review) {
        const v = body.review;
        await store.setSetting("review", { maxFindings: Math.min(12, Math.max(3, Number(v.maxFindings) || 8)), diffChars: Number(v.diffChars) || 90000, temperature: Math.min(1, Math.max(0, Number(v.temperature) || 0)) });
      }
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
      if (!PB_URL) return { sections: [{ id: "oauth", title: "Sign-in with GitHub", description: "Sign-in needs PocketBase. Start with PB_URL set (the Docker image does) to configure it.", fields: [] }], values: {} };
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
        if (!PB_URL) throw new Error("Sign-in needs PocketBase (PB_URL)");
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
      if (!PB_URL) throw new Error("Sign-in needs PocketBase (PB_URL)");
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
    if (!PB_URL) return { sections: [{ id: "accounts", title: "Accounts", description: "Accounts need PocketBase.", fields: [] }], values: {} };
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
      { label: "Model provider", hint: `${PROVIDERS[c.provider]?.label || c.provider} · ${c.model}`, path: "/settings/model" },
      { label: "Repositories", hint: "Add or remove onboarded repositories", path: "/settings/repos" },
      { label: "Sign-in (OAuth)", hint: "GitHub login through PocketBase", path: "/settings/oauth" },
      ...(PB_URL ? [{ label: "PocketBase admin", hint: "Data, users and collections", href: `${(process.env.PB_PUBLIC_URL || PB_URL).replace(/\/+$/, "")}/_/` }] : []),
      { label: "Documentation", hint: "README on GitHub", href: "https://github.com/dharmeshgurnani/pr-scorer#readme" },
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
        if (!PB_URL) throw new Error("Sign-in needs PocketBase (PB_URL)");
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
          return json(await action(req, res));
        }
        const scope = { org: url.searchParams.get("org") || "" };
        if (scope.org && !OWNER_RE.test(scope.org)) throw new Error("Bad organization");
        if (req.method === "POST") await page.save(await readJson(req), scope, user);
        return json(await page.load(scope, user));
      }
      if (url.pathname === "/api/score" || (url.pathname === "/score" && url.searchParams.get("pr"))) {
        if (!(await gate(req, res)).ok) return;
        const ref = (url.searchParams.get("pr") || "").trim();
        if (!ref) throw new Error("Missing pr");
        const result = await score(ref, url.searchParams.has("force"), url.searchParams.get("repo") || "");
        if (url.pathname === "/api/score") return json(result);
        res.setHeader("content-type", "text/html; charset=utf-8");
        return res.end(renderScore(result));
      }
      // ponytail: serve the built React app when it exists, fall back to the server-rendered pages otherwise
      const ext = url.pathname.split(".").pop();
      const asset = join(DIST, url.pathname);
      if (existsSync(DIST)) {
        const f = MIME[ext] && existsSync(asset) ? asset : join(DIST, "index.html");
        res.setHeader("content-type", `${MIME[f.split(".").pop()] || "text/html"}; charset=utf-8`);
        return res.end(readFileSync(f));
      }
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(await renderHome());
    } catch (e) {
      res.statusCode = 500;
      json({ error: e.message });
    }
  })
  .listen(PORT, async () => console.log(`PR Scorer on http://localhost:${PORT} (repo ${REPO}, model ${(await llmConfig()).model}, store ${PB_URL ? `PocketBase ${PB_URL}` : "scores/"})`));
