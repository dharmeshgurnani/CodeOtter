// CodeOtter backend. `node core/server.mjs` then open http://localhost:4747. Startup, the HTTP server (Hono, routes in
// app.mjs and routes/) and the services the TUI imports.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { forgeOrigin, FORGES, IS_SERVER, OWNER_RE, PORT, REPO, ROOT } from "./config.mjs";
import { PROVIDERS } from "./providers.mjs";
import { stopSidecars } from "./local-models.mjs";
import { PB_URL, store } from "./store.mjs";
import { applyGithubToken, forgeId, openPrs, parsePrUrl, readPr, repos } from "./git.mjs";
import { llmConfig, s1Config } from "./models.mjs";
import { blastRadius } from "./diff.mjs";
import { reviewConfig } from "./context.mjs";
import { judge, scoreWithSystemOne } from "./engines.mjs";
import { startOrPollReview } from "./review.mjs";
import { redeliverGitHubFailures, syncForwarders } from "./queue.mjs";
import { repoOf } from "./views.mjs";
import { AZURE_ORG_RE } from "./settings-pages.mjs";
import { checkRepoScope } from "./access.mjs";
import { app } from "./app.mjs";
import { DIST } from "./routes/site.mjs";

// Signals stop the sidecars whether or not PocketBase was auto-started (that path adds its own handler). Without this a
// docker stop or Ctrl-C leaves laya / llama-server / python holding their ports and the next start reports "runtime exited".
if (IS_SERVER) {
  for (const sig of ["SIGINT", "SIGTERM"]) process.once(sig, () => { stopSidecars(); process.exit(); });
  process.on("unhandledRejection", (e) => console.error("[unhandledRejection]", e?.stack || e));
  process.on("uncaughtException", (e) => console.error("[uncaughtException]", e?.stack || e));
}

if (IS_SERVER && !existsSync(DIST)) {
  console.log("web/dist not found. Building web frontend...");
  try {
    const isWin = process.platform === "win32";
    const pnpmCmd = isWin ? "pnpm.cmd" : "pnpm";
    execFileSync(pnpmCmd, ["-C", join(ROOT, "web"), "build"], { stdio: "inherit" });
  } catch (err) {
    console.warn("Could not auto-build web frontend:", err.message);
  }
}
let coreReady;
export function initializeCore() {
  return coreReady ||= initializeStorage().catch(error => { coreReady = null; throw error; });
}
async function initializeStorage() {
await store.init();
applyGithubToken(await store.getSetting("githubToken"));
for (const [id, f] of Object.entries(FORGES)) {
  const saved = await store.getSetting(id);
  if (!saved) continue;
  if (!f.fixed) f.url = forgeOrigin(saved.url);
  f.token = saved.token || "";
  if ("user" in saved) f.user = String(saved.user || "");
  if (Array.isArray(saved.orgs)) f.orgs = saved.orgs.filter((o) => AZURE_ORG_RE.test(o));
}
const origins = Object.values(FORGES).map((f) => f.url).filter(Boolean);
if (new Set(origins).size !== origins.length) throw new Error("Each provider must use a separate server origin");
for (const [id, f] of Object.entries(FORGES)) {
  if (f.fixed) continue;
  const previous = await store.getSetting(`${id}Origin`);
  if (previous && previous !== f.url) {
    const linked = (await repos()).some((r) => forgeId(r) === id) || (await store.all()).some((r) => r.pr?.url?.startsWith(`${previous}/`));
    if (linked || (PB_URL && !!f.pb && ((await store.getOAuth()).providers.some((p) => p.name === f.pb) || await store.hasForgeIdentities(f.pb)))) throw new Error(`${f.label} origin changed while repositories or OAuth identities are linked`);
  }
  if (f.url && previous !== f.url) await store.setSetting(`${id}Origin`, f.url);
}
}

// Local operator interface: same storage credentials and models as this installation.
// Web callers still go through gate(); no HTTP authentication is bypassed or changed.
export async function repositoryBoard(org = "") {
  await initializeCore();
  if (org && !OWNER_RE.test(org)) throw new Error("Bad organization");
  const rs = await repos();
  const c = await llmConfig();
  const scoped = rs.filter(r => org && r.startsWith(`${org}/`));
  return {
    repos: rs, model: `${c.provider}/${c.model}`, store: PB_URL ? "pocketbase" : "files",
    forgeUrls: Object.fromEntries(Object.entries(FORGES).map(([id, f]) => [id, f.url])),
    reviewed: org ? (await store.all()).filter(r => repoOf(r.pr).startsWith(`${org}/`)) : [],
    open: (await Promise.all(scoped.map(openPrs))).flat(),
  };
}
export async function repositoryReview(repo, pr, force = false) {
  await initializeCore();
  checkRepoScope(repo, repo.split("/")[0]);
  if (!(await repos()).includes(repo) || parsePrUrl(pr)?.repo !== repo) throw new Error("Pull request is outside the connected repository");
  return startOrPollReview(pr, force, repo, "", false);
}
// Local diff review for the CLI, TUI and MCP server: the same engines and rules as a pull request review. A configured
// System One model owns every score and gate; the language model is asked for scores only when there is none, and no
// gates are reported without System One. `llm` (provider, model, baseUrl, apiKey) overrides the saved language model.
export async function reviewDiff({ title = "Local changes", body = "", diff, files, guide = null, llm = null, onProgress = null, signal = null }) {
  await initializeCore();
  if (!diff?.trim()) throw new Error("Empty diff");
  const [saved, s1Saved, rc] = await Promise.all([llmConfig(), s1Config(), reviewConfig()]);
  const c = { ...(llm?.model
    ? { provider: llm.provider || "custom", api: llm.provider === "anthropic" ? "anthropic" : "openai", baseUrl: llm.baseUrl || "", model: llm.model, apiKey: llm.apiKey || "" }
    : saved), signal };
  const s1 = { ...s1Saved, signal };
  const llmReady = c.local ? c.enabled : !!c.model && (!!c.apiKey || !!PROVIDERS[c.provider]?.noKey || /localhost|127\.0\.0\.1/.test(c.baseUrl));
  if (!llmReady && !s1.enabled) throw new Error("No model configured: open Settings / Model provider, or pass --provider and --model");
  if (llmReady && c.api === "codereviewer" && !s1.enabled) throw new Error(`${c.local.label} writes review comments only. Configure a System One model for scores.`);
  const sum = (k) => files.reduce((n, f) => n + (Number(f[k]) || 0), 0);
  const pr = { number: 0, url: "", title, body, author: { login: process.env.USER || process.env.USERNAME || "local" }, baseRefName: "", headRefName: "", files, changedFiles: files.length, additions: sum("additions"), deletions: sum("deletions"), commits: [] };
  const g = guide ? (typeof guide === "string" ? { file: "AGENTS.md", text: guide } : guide) : null;
  const [typed, narrative] = await Promise.all([
    s1.enabled ? scoreWithSystemOne(pr, diff, s1, g, null, null) : null,
    llmReady ? judge(pr, diff, c, rc, g, !s1.enabled, null, onProgress) : null,
  ]);
  const { blast_radius, ...scores } = typed ? typed.scores : { ...narrative.scores, blast_radius: narrative.blastRadius };
  const gates = typed?.gates || [];
  const bad = gates.some((x) => x.id === "security" && !x.pass) || scores.quality < 40;
  const review = narrative || { summary: "Scored by CodeOtter.", verdict: bad ? "request_changes" : scores.quality >= 70 && gates.every((x) => x.pass) ? "approve" : "comment", findings: [], walkthrough: [] };
  const engines = { llm: llmReady ? `${c.provider}/${c.model}` : null, s1: s1.enabled ? `${s1.provider}/${s1.model}` : null };
  return {
    title, body, files, scores, gates,
    blast: { ...blastRadius(files), score: blast_radius, source: typed ? "s1" : "llm" },
    summary: review.summary, verdict: review.verdict, findings: review.findings, walkthrough: review.walkthrough,
    engines, model: [engines.llm, engines.s1].filter(Boolean).join(" + "),
  };
}
export async function repositoryDiff(repo, pr) {
  await initializeCore();
  checkRepoScope(repo, repo.split("/")[0]);
  const parsed = parsePrUrl(pr);
  if (!(await repos()).includes(repo) || parsed?.repo !== repo) throw new Error("Pull request is outside the connected repository");
  return readPr(pr, ["-R", repo, String(parsed.number)], true);
}

if (IS_SERVER) {
  await initializeCore();
  const server = serve({ fetch: app.fetch, port: Number(PORT) }, async () => {
    console.log(`CodeOtter on http://localhost:${PORT} (repo ${REPO}, model ${(await llmConfig()).model}, store ${PB_URL ? `PocketBase ${PB_URL}` : "scores/"})`);
    syncForwarders().catch((e) => console.warn(`[forwarder] ${e.message}`));
    redeliverGitHubFailures().catch((e) => console.warn(`[webhook github] redelivery: ${e.message}`));
  });
  server.setTimeout(0); // Node cuts requests at 300 s by default; a cold local sidecar plus a long review can take longer
  server.on("error", (e) => {
    console.error(e.code === "EADDRINUSE" ? `Port ${PORT} is already in use (set PORT to pick another)` : `Cannot listen on ${PORT}: ${e.message}`);
    process.exit(1);
  });
}
