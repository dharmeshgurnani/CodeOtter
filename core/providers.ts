// Language and System One providers, model icons, and the local model catalog (models.json).
import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { CODEOTTER_HOME } from "./config.ts";
import type { BinaryRuntime, LocalModel, ModelCatalog, Runtime } from "./local-models.ts";

// A hosted (or local, `local`) language model provider. `api` picks the wire format: "anthropic" or "openai".
export interface ProviderDef {
  label: string;
  api: string;
  baseUrl: string;
  models: string[];
  keyEnv?: string;
  keyUrl?: string;
  noKey?: boolean;
  local?: LocalModel;
}
// A System One provider: same typed /v1/systemone contract everywhere.
export interface S1ProviderDef {
  label: string;
  baseUrl: string;
  models: string[];
  keyEnv: string;
  keyUrl?: string;
  listPrefix?: string;
  local?: boolean;
}
export interface ModelChoice { value: string; label: string; icon: string }
// Connection settings used to list a provider's models.
export interface ModelListConfig { provider?: string; baseUrl?: string; apiKey?: string }
export interface LlmDefaults { provider: string; baseUrl: string; model: string; apiKey: string }

// Hugging Face organization/author avatars for model & provider selection lists.
export const HF_LOGO = "https://huggingface.co/front/assets/huggingface_logo-noborder.svg";
export const HF_AVATARS: Record<string, string> = {
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
const CLOUDFLARE_ICON = "https://www.cloudflare.com/favicon.ico";
export function modelIcon(id = "", provider = ""): string {
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
  if (/clef|cloudflare/.test(s)) return CLOUDFLARE_ICON;
  if (s.includes("/")) {
    const owner = String(id).split("/")[0];
    return HF_AVATARS[owner.toLowerCase()] || `/api/hf-avatar?owner=${encodeURIComponent(owner)}`;
  }
  if (HF_AVATARS[p]) return HF_AVATARS[p];
  return HF_LOGO;
}
export function providerIcon(key: string): string {
  const k = String(key).replace(/^local_/, "");
  if (LOCAL[k]) return LOCAL[k].icon || modelIcon(LOCAL[k].repo, k);
  if (k === "jev" || k === "jev_openrouter") return HF_AVATARS.mys;
  if (k === "clef") return CLOUDFLARE_ICON;
  if (k === "openrouter" || k === "custom") return HF_LOGO;
  return HF_AVATARS[k] || HF_LOGO;
}

// Providers. Everything except Anthropic speaks the OpenAI chat/completions shape.
export const PROVIDERS: Record<string, ProviderDef> = {
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
export const modelCache = new Map<string, { list: ModelChoice[]; at: number }>();
export async function listModels(kind: string, c: ModelListConfig): Promise<ModelChoice[]> {
  const key = `${kind}|${c.baseUrl}|${(c.apiKey || "").slice(-8)}`;
  const hit = modelCache.get(key);
  if (hit && Date.now() - hit.at < 600e3) return hit.list;
  let list: ModelChoice[] = [];
  const base = (c.baseUrl || "").replace(/\/+$/, "");
  const opt = (headers: Record<string, string>) => ({ headers, signal: AbortSignal.timeout(10000) });
  try {
    if (kind === "anthropic") {
      const r = await fetch(`${base}/v1/models?limit=1000`, opt({ "x-api-key": c.apiKey as string, "anthropic-version": "2023-06-01" }));
      if (r.ok) list = (((await r.json()) as { data?: { id: string; display_name?: string }[] }).data || []).map((m) => ({ value: m.id, label: m.display_name ? `${m.display_name} (${m.id})` : m.id, icon: modelIcon(m.id, c.provider) }));
    } else if (kind === "openai") {
      const r = await fetch(`${base}/models`, opt(c.apiKey ? { authorization: `Bearer ${c.apiKey}` } : {}));
      if (r.ok) {
        const d = ((await r.json()) as { data?: { id: string; architecture?: { modality?: string } }[] }).data || [];
        list = d
          .filter((m) => m.id && (!m.architecture?.modality || /->text$/.test(m.architecture.modality)) && !/^typesafe\/jev-\d/.test(m.id))
          .map((m) => ({ value: m.id, label: m.id, icon: modelIcon(m.id, c.provider) }))
          .sort((a, b) => a.value.localeCompare(b.value));
      }
    } else if (kind === "s1-typesafe") {
      const r = await fetch(`${base}/v1/models`, opt({ authorization: `Bearer ${c.apiKey}`, accept: "application/json" }));
      // the list holds ids or { id } objects; an object without one passes through as it always has
      if (r.ok) list = (((await r.json()) as { models?: (string | { id?: string })[] }).models || []).map((m) => { const id = (typeof m === "string" ? m : m.id || m) as string; return { value: id, label: id, icon: modelIcon(id, c.provider) }; });
    } else if (kind === "s1-openrouter") {
      // decision models are listed only when every output modality is asked for
      const prefix = S1_PROVIDERS[String(c.provider)]?.listPrefix || "";
      const r = await fetch(`${base}/v1/models?output_modalities=all`, opt({}));
      if (r.ok) list = (((await r.json()) as { data?: { id: string; architecture?: { output_modalities?: string[] } }[] }).data || []).filter((m) => m.architecture?.output_modalities?.includes("decisions") && m.id.startsWith(prefix)).map((m) => ({ value: m.id, label: m.id, icon: modelIcon(m.id, c.provider) }));
    }
  } catch {}
  modelCache.set(key, { list, at: Date.now() });
  return list;
}
export const ENV_DEFAULTS: LlmDefaults = process.env.LLM_BASE_URL
  ? { provider: "custom", baseUrl: process.env.LLM_BASE_URL, model: process.env.LLM_MODEL || "", apiKey: process.env.LLM_API_KEY || "" }
  : { provider: "minimax", baseUrl: PROVIDERS.minimax.baseUrl, model: process.env.LLM_MODEL || "MiniMax-M3", apiKey: process.env.LLM_API_KEY || "" };
// System One models answer typed questions (scores, yes/no gates) in one fast pass; they cannot write prose.
// When one is configured it owns the scores and the merge gates; the language model keeps the narrative
// (summary, walkthrough, findings). Both run in parallel when both are configured.
// Local models (models.json): open-weight System One models served by the `laya` runtime (ggmlc) as a sidecar,
// downloaded with one click into DATA_DIR. Same /v1/systemone contract as Jev, so scoring code does not change.
const CATALOG = JSON.parse(readFileSync(join(import.meta.dirname, "models.json"), "utf8")) as ModelCatalog;
const DATA_DIR = process.env.PR_SCORER_DATA || join(CODEOTTER_HOME, ".local");
export const LOCAL: Record<string, LocalModel> = Object.fromEntries(CATALOG.models.map((m) => [m.id, m])); // both kinds: "s1" (typed) and "llm" (chat)
export const LOCAL_S1 = CATALOG.models.filter((m) => m.kind === "s1");
// Shown beside small-context System One models wherever they are picked: they read only part of a large pull request.
export const contextNote = (m: LocalModel): string => (m.kind === "s1" && m.contextTokens < 8192 ? `Reads ${m.contextTokens} tokens (about ${m.contextChars.toLocaleString("en")} characters) per question. On larger pull requests it sees only part of the change, so scores and gates are less accurate.` : "");
export const LOCAL_LLM = CATALOG.models.filter((m) => m.kind === "llm");
export const S1_PROVIDERS: Record<string, S1ProviderDef> = {
  jev: { label: "TypeSafe Jev", baseUrl: "https://api.typesafe.ai", models: ["jev-latest", "jev-1.13.0"], keyEnv: "TYPESAFE_API_KEY", keyUrl: "https://console.typesafe.ai/settings/keys" },
  // OpenRouter serves the same typed endpoint (POST /api/v1/systemone) with an OpenRouter key
  jev_openrouter: { label: "TypeSafe Jev via OpenRouter", baseUrl: "https://openrouter.ai/api", models: ["typesafe/jev-1.13"], listPrefix: "typesafe/jev-", keyEnv: "OPENROUTER_API_KEY", keyUrl: "https://openrouter.ai/keys" },
  // Cloudflare's Clef speaks the same typed contract; OpenRouter serves it on the same endpoint
  clef: { label: "Cloudflare Clef via OpenRouter", baseUrl: "https://openrouter.ai/api", models: ["cloudflare/clef", "cloudflare/clef-flash"], listPrefix: "cloudflare/clef", keyEnv: "OPENROUTER_API_KEY", keyUrl: "https://openrouter.ai/keys" },
  ...Object.fromEntries(LOCAL_S1.map((m) => [m.id, { get label() { return modelReady(m) ? `${m.label} (local)` : `${m.label} (local), not downloaded`; }, local: true, baseUrl: "", models: [m.modelId], keyEnv: "" }])),
  custom: { label: "Custom System One endpoint", baseUrl: "", models: [], keyEnv: "", keyUrl: "" },
};
export const RUNTIMES: Record<string, Runtime> = CATALOG.runtimes;
// assets and bin exist only on binary runtimes (a python runtime reads them as undefined, as it always has)
export const runtimeAssets = (name: string): string[] => (RUNTIMES[name] as BinaryRuntime).assets?.[`${process.platform}-${process.arch}`] || [];
export const runtimeDir = (name: string) => join(DATA_DIR, "runtime", name);
export const runtimeBin = (name: string) => join(runtimeDir(name), process.platform === "win32" ? `${(RUNTIMES[name] as BinaryRuntime).bin}.exe` : (RUNTIMES[name] as BinaryRuntime).bin);
export const modelPath = (m: LocalModel) => join(DATA_DIR, "models", (m.dir || m.file) as string); // a single GGUF, or a directory of checkpoint files
export const modelReady = (m: LocalModel): boolean => (m.files ? m.files.every((f) => existsSync(join(modelPath(m), f))) : existsSync(modelPath(m)));
// Local language models (models.json, kind "llm") served by llama-server as a sidecar; same OpenAI chat shape.
for (const m of LOCAL_LLM) PROVIDERS[`local_${m.id}`] = { get label() { return modelReady(m) ? `${m.label} (local)` : `${m.label} (local), not downloaded`; }, api: m.api || "openai", local: m, baseUrl: "", models: [m.modelId], noKey: true };
export const fileSize = (p: string): number => (existsSync(p) ? statSync(p).size : 0);
