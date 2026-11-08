// Model calls: System One (POST /v1/systemone) and language models (Anthropic Messages or OpenAI chat).
import { ENV_DEFAULTS, LOCAL, modelReady, PROVIDERS, S1_PROVIDERS } from "./providers.ts";
import { ensureSidecar } from "./local-models.ts";
import { store } from "./store.ts";
import type { LocalModel } from "./local-models.ts";

// System One: typed questions in, typed answers out (POST /v1/systemone with `state` + `questions`).
// `score` picks one of five `criteria` levels (answer.score 0..4); `noul` is a yes/no probability (answer.noul 0..1).
export type S1Question = { type: "score"; instructions: string; criteria: string[] } | { type: "noul"; instructions: string };
export type S1Questions = Record<string, S1Question>;
// Answers are model output: fields are read through Number() and checked, never trusted as typed.
export interface S1Answer { score?: unknown; noul?: unknown; [field: string]: unknown; }
export type S1Answers = Record<string, S1Answer>;
export type S1State = Record<string, unknown>;
export interface S1Config {
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
  local?: LocalModel;
  contextChars?: number;
  signal?: AbortSignal; // optional caller abort, next to the request timeout
}
export interface LlmConfig {
  provider: string;
  api?: string; // "anthropic" | "openai" | "codereviewer"
  baseUrl: string;
  model: string;
  apiKey: string;
  local?: LocalModel;
  contextChars?: number;
  enabled?: boolean;
  source: "settings" | "env";
  temperature?: number;
  signal?: AbortSignal;
}

export async function s1Config(): Promise<S1Config> {
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
// Model calls carry an optional caller abort signal on the config (c.signal) next to their timeout.
const withAbort = (signal: AbortSignal | undefined, ms: number): AbortSignal => (signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms));
export async function askSystemOne(state: S1State, questions: S1Questions, c: S1Config, onChunk?: (answers: S1Answers) => void): Promise<S1Answers> {
  if (!c.enabled) throw new Error(c.local ? `${c.local.label} is not downloaded: open Settings / Local models` : "No System One model configured: open Settings");
  const base = c.local ? `http://127.0.0.1:${await ensureSidecar(c.local)}` : c.baseUrl.replace(/\/+$/, "");
  const max = onChunk ? Math.min(c.local?.maxQuestions || 2, 2) : c.local?.maxQuestions || 0;
  const keys = Object.keys(questions);
  if (max && keys.length > max) {
    // the runtime answers at most `max` questions per request; ask in chunks, merge, and stream partial answers
    const answers: S1Answers = {};
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
    signal: withAbort(c.signal, c.local ? 300000 : 60000),
  });
  if (!res.ok) throw new Error(`${S1_PROVIDERS[c.provider]?.label || c.provider} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const ans = ((await res.json()) as { answers?: S1Answers }).answers || {};
  onChunk?.(ans);
  return ans;
}

export async function llmConfig(): Promise<LlmConfig> {
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

// One prompt in, text out. Anthropic uses the Messages API; everyone else is OpenAI chat/completions.
// <ask-model>
export async function askModel(prompt: string, c: LlmConfig): Promise<string> {
  if (!c.model) throw new Error("No model configured: open Settings");
  if (c.local && !c.enabled) throw new Error(`${c.local.label} is not downloaded: open Settings / Local models`);
  if (!c.local && !c.apiKey && !PROVIDERS[c.provider]?.noKey && !/localhost|127\.0\.0\.1/.test(c.baseUrl)) throw new Error(`No API key for ${PROVIDERS[c.provider]?.label || c.provider}: open Settings`);
  const base = c.local ? `http://127.0.0.1:${await ensureSidecar(c.local)}/v1` : c.baseUrl.replace(/\/+$/, "");
  if (c.api === "codereviewer") {
    // No chat endpoint: the test sends one hunk through /v1/review and reports the comment.
    const res = await fetch(`${base}/review`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ hunks: [{ file: "src/math.js", diff: [" function add(a, b) {", "-  return a + b;", "+  return a - b;", " }", ""].join("\n") }] }), signal: AbortSignal.timeout(300000) });
    if (!res.ok) throw new Error(`CodeReviewer ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const { comments } = (await res.json()) as { comments?: { comment?: unknown }[] };
    return `OK: ${String(comments?.[0]?.comment || "").trim() || "(no comment)"}`;
  }
  if (c.api === "anthropic") {
    const res = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": c.apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: c.model, max_tokens: 16000, ...(/^claude-(opus|sonnet|fable)-5/.test(c.model) ? { output_config: { effort: "high" } } : {}), messages: [{ role: "user", content: prompt }] }),
      signal: withAbort(c.signal, 600000),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const msg = (await res.json()) as { stop_reason?: string; stop_details?: { category?: string }; content?: unknown };
    if (msg.stop_reason === "refusal") throw new Error(`Anthropic declined the request (${msg.stop_details?.category || "refusal"})`);
    if (msg.stop_reason === "max_tokens") throw new Error("Anthropic response was cut off at max_tokens: the review is incomplete");
    if (!Array.isArray(msg.content)) throw new Error(`Anthropic returned no content: ${JSON.stringify(msg).slice(0, 300)}`);
    return (msg.content as { type?: string; text?: string }[]).filter((b) => b.type === "text").map((b) => b.text).join("");
  }
  // Claude 4 and later ids get the 16000-token output budget the Messages route uses; Claude 5 ids refuse sampling parameters.
  // Claude 3.x ids put the version first (claude-3-5-sonnet), so they match neither test and keep the body they had.
  const claude4Plus = /(^|\/)claude-(opus|sonnet|haiku|fable)-\d/.test(c.model);
  const claude5 = /(^|\/)claude-(opus|sonnet|haiku|fable)-5([-.]|$)/.test(c.model);
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(c.apiKey ? { authorization: `Bearer ${c.apiKey}` } : {}) },
    body: JSON.stringify({ model: c.model, ...(claude4Plus ? { max_tokens: 16000 } : {}), ...(claude5 ? {} : { temperature: c.temperature ?? 0.2 }), messages: [{ role: "user", content: prompt }] }),
    signal: withAbort(c.signal, c.local ? 900000 : 180000),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 300)}`);
  // Proxies and some local servers answer 200 with {error} or an empty choices list; show that instead of a TypeError.
  const body = (await res.json().catch(() => null)) as { choices?: { message?: { content?: unknown } }[]; error?: { message?: string } | string } | null;
  const text = body?.choices?.[0]?.message?.content;
  if (typeof text !== "string") throw new Error(`LLM returned no text: ${(body?.error && typeof body.error === "object" ? body.error.message : undefined) || body?.error || JSON.stringify(body ?? "").slice(0, 300)}`);
  return text.replace(/<think>[\s\S]*?<\/think>/g, "");
}

// </ask-model>
