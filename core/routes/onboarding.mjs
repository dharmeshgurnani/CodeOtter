// The onboarding wizard: status, repository choices, provider test and save, models, repositories, completion.
// Mounted at /api/onboarding; admin and owner only.
import { Hono } from "hono";
import { makeForge } from "../forges.mjs";
import { APP_URL, FORGE_IDS, forgeActive, forgeOrigin, FORGES } from "../config.mjs";
import { contextNote, LOCAL, LOCAL_LLM, LOCAL_S1, modelCache, modelReady, PROVIDERS, S1_PROVIDERS } from "../providers.mjs";
import { downloadModel, downloads, localStatus } from "../local-models.mjs";
import { PB_URL, store } from "../store.mjs";
import { applyGithubToken, ghAsync, repoLabel, repos, repositoryChoices } from "../git.mjs";
import { llmConfig, s1Config } from "../models.mjs";
import { reposChanged } from "../queue.mjs";
import { AZURE_ORG_RE, entraTenant, FORGE_CONNECTIONS, LOGIN_PROVIDERS, oauthProvider } from "../settings-pages.mjs";
import { gate, jsonBody } from "./middleware.mjs";

export const onboarding = new Hono();
onboarding.use(gate("admin"));

async function status(c) {
  const rs = await repos();
  const savedComplete = (await store.getSetting("onboardingComplete")) === true;
  const s1 = await s1Config();
  const llm = await llmConfig();
  const o = PB_URL ? await store.getOAuth() : null;
  return c.json({
    completed: savedComplete && rs.length > 0,
    appUrl: APP_URL,
    hasPb: !!PB_URL,
    primaryProvider: (await store.getSetting("primaryProvider")) || FORGE_IDS.find(forgeActive) || "github",
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
onboarding.get("/", status);
onboarding.get("/status", status);

onboarding.get("/repos", async (c) => {
  const choices = await repositoryChoices();
  return c.json({ repos: choices.map((r) => ({ id: r, label: repoLabel(r), org: r.split("/")[0] })) });
});

// Checks the entered values without saving them; a failure is { ok: false, error }, not an HTTP error.
onboarding.post("/test-provider", async (c) => {
  const body = await jsonBody(c);
  const provider = body.provider || "github";
  if (provider === "github") {
    try {
      if (body.token) {
        const r = await fetch("https://api.github.com/user", { headers: { authorization: `token ${body.token}`, "user-agent": "CodeOtter" } });
        if (!r.ok) throw new Error(`GitHub token verification failed (${r.status})`);
        const user = await r.json();
        return c.json({ ok: true, message: `Connected as @${user.login}` });
      }
      await ghAsync("repo", "list", "--limit", "1", "--json", "nameWithOwner");
      return c.json({ ok: true, message: "Connected via GitHub CLI" });
    } catch (err) {
      return c.json({ ok: false, error: err.message });
    }
  }
  if (Object.hasOwn(FORGES, provider)) {
    try {
      // the entered values on a copy of the provider: nothing is saved until save-provider
      const f = FORGES[provider];
      const draft = { ...f, url: f.fixed ? f.url : forgeOrigin(body.url || f.url), token: String(body.token || f.token || ""),
        ...(f.kind === "bitbucket" ? { user: String(body.user ?? f.user ?? "").trim() } : {}),
        ...(f.kind === "azure" ? { orgs: body.orgs !== undefined ? String(body.orgs).split(/[\s,]+/).filter(Boolean) : f.orgs } : {}) };
      if (!draft.url) throw new Error(`Please provide a ${f.label} server URL`);
      if (draft.orgs?.some((o) => !AZURE_ORG_RE.test(o))) throw new Error("Not an Azure DevOps organization name");
      return c.json({ ok: true, message: await makeForge(provider, draft).test() });
    } catch (err) {
      return c.json({ ok: false, error: err.message });
    }
  }
  throw new Error("Unknown provider");
});

onboarding.post("/save-provider", async (c) => {
  const body = await jsonBody(c);
  const provider = body.provider || "github";
  await store.setSetting("primaryProvider", provider);
  if (provider === "github" && body.token) {
    const tok = String(body.token).trim();
    await store.setSetting("githubToken", tok);
    applyGithubToken(tok);
  }
  if (Object.hasOwn(FORGES, provider) && (body.url || body.token)) {
    await FORGE_CONNECTIONS[provider].save({ [provider]: { url: body.url, token: body.token, ...("user" in body ? { user: body.user } : {}), ...("orgs" in body ? { orgs: body.orgs } : {}) } });
  }
  if (PB_URL && (body.clientId || body.clientSecret)) {
    const o = await store.getOAuth();
    const spec = Object.hasOwn(LOGIN_PROVIDERS, provider) && LOGIN_PROVIDERS[provider];
    if (spec) {
      const current = o.providers.find((p) => p.name === spec.pb);
      const providers = o.providers.filter((p) => p.name !== spec.pb);
      providers.push(oauthProvider(provider, current, body.clientId, body.clientSecret, body.tenant ?? entraTenant(current)));
      await store.setOAuth({ ...o, enabled: true, providers });
    }
  }
  return c.json({ ok: true });
});

onboarding.post("/save-models", async (c) => {
  const body = await jsonBody(c);
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
  return c.json({ ok: true });
});

onboarding.post("/save-repos", async (c) => {
  const body = await jsonBody(c);
  const nextRepos = Array.isArray(body.repos) ? body.repos.filter(Boolean) : [];
  if (!nextRepos.length) throw new Error("Please select at least one repository");
  const before = await repos();
  await store.setSetting("repos", nextRepos);
  reposChanged(before, nextRepos).catch((e) => console.warn(`[repos] ${e.message}`));
  return c.json({ ok: true, repos: nextRepos });
});

onboarding.post("/complete", async (c) => {
  await store.setSetting("onboardingComplete", true);
  const rs = await repos();
  return c.json({ ok: true, org: rs[0] ? rs[0].split("/")[0] : "" });
});
