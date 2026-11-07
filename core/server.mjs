// CodeOtter backend. `node core/server.mjs` then open http://localhost:4747. Dependency-free; the rest of core/ is plain modules.
import http from "node:http";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { makeForge } from "./forges.mjs";
import { APP_URL, availableUpdate, FORGE_IDS, forgeActive, forgeOrigin, FORGES, IS_SERVER, OWNER_RE, PORT, REPO, ROOT, VERSION } from "./config.mjs";
import { contextNote, HF_AVATARS, HF_LOGO, LOCAL, LOCAL_LLM, LOCAL_S1, modelCache, modelReady, PROVIDERS, S1_PROVIDERS } from "./providers.mjs";
import { downloadModel, downloads, localStatus, stopSidecars } from "./local-models.mjs";
import { PB_URL, SCORES, store } from "./store.mjs";
import { applyGithubToken, forgeId, forgetGithubRepos, ghAsync, openPrs, parsePrUrl, readPr, repoLabel, repos, repositoryChoices, validPrUrl } from "./git.mjs";
import { llmConfig, s1Config } from "./models.mjs";
import { blastRadius } from "./diff.mjs";
import { getRepoLearnings, reviewConfig, setRepoLearnings } from "./context.mjs";
import { deriveSuggestionFromDetail, judge, scoreWithSystemOne } from "./engines.mjs";
import { activeReviews, postInlineSuggestionsOnPr, resolvePr, score, startOrPollReview, triagePr } from "./review.mjs";
import { PR_TOOLS, runPrTool } from "./pr-tools.mjs";
import { handleWebhook, redeliverGitHubFailures, reposChanged, syncForwarders } from "./queue.mjs";
import { esc, homeData, renderHome, renderScore, repoOf, VERDICT } from "./views.mjs";
import { AZURE_ORG_RE, ENTRA_TENANT_RE, entraTenant, FORGE_CONNECTIONS, LOGIN_PROVIDERS, oauthFlows, oauthProvider, SETTINGS_PAGES, settingsPages } from "./settings-pages.mjs";
import { admit, assertRepo, checkRepoScope, cookies, currentUser, developerBlocked, gate, NOT_INVITED, onboardedRepo, requestOrg, seesAll, setCookie, visibleRepos } from "./access.mjs";

// Signals stop the sidecars whether or not PocketBase was auto-started (that path adds its own handler). Without this a
// docker stop or Ctrl-C leaves laya / llama-server / python holding their ports and the next start reports "runtime exited".
if (IS_SERVER) {
  for (const sig of ["SIGINT", "SIGTERM"]) process.once(sig, () => { stopSidecars(); process.exit(); });
  process.on("unhandledRejection", (e) => console.error("[unhandledRejection]", e?.stack || e));
  process.on("uncaughtException", (e) => console.error("[uncaughtException]", e?.stack || e));
}

const DIST = join(ROOT, "web", "dist");
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
const MIME = { html: "text/html", js: "text/javascript", css: "text/css", svg: "image/svg+xml", png: "image/png", ico: "image/x-icon", json: "application/json", webmanifest: "application/manifest+json", woff2: "font/woff2" };
const CODEOTTER_PATH_TAG = "<path fill=\"#E5E7EB\" fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M 346.13 103.28 C 347.01 103.28, 346.38 101.15, 349.89 103.90 C 353.39 106.66, 359.40 113.92, 363.66 117.05 C 367.91 120.18, 367.29 119.30, 371.17 119.55 C 375.05 119.80, 379.43 115.67, 383.06 118.30 C 386.69 120.93, 385.44 127.31, 389.32 132.69 C 393.20 138.08, 399.33 141.46, 402.46 145.21 C 405.59 148.97, 404.47 148.47, 404.97 151.47 C 405.47 154.48, 405.47 157.23, 404.97 160.23 C 404.47 163.24, 403.84 164.37, 402.46 166.49 C 401.09 168.62, 401.09 170.12, 398.08 170.88 C 395.08 171.63, 390.32 171.25, 387.44 170.25 C 384.56 169.25, 384.44 168.12, 383.69 165.87 C 382.94 163.61, 382.06 161.86, 383.69 158.98 C 385.31 156.10, 389.82 154.73, 391.82 151.47 C 393.83 148.22, 394.58 145.34, 393.70 142.71 C 392.83 140.08, 390.95 139.20, 387.44 138.33 C 383.94 137.45, 379.81 137.95, 376.18 138.33 C 372.55 138.70, 371.79 138.70, 369.29 140.21 C 366.79 141.71, 364.03 143.21, 363.66 145.84 C 363.28 148.47, 364.53 150.85, 367.41 153.35 C 370.29 155.85, 376.30 155.85, 378.05 158.36 C 379.81 160.86, 377.55 163.36, 376.18 165.87 C 374.80 168.37, 375.05 168.62, 371.17 170.88 C 367.29 173.13, 361.91 176.01, 356.77 177.13 C 351.64 178.26, 349.51 177.64, 345.51 176.51 C 341.50 175.38, 339.00 172.25, 336.74 171.50 C 334.49 170.75, 333.49 171.25, 334.24 172.75 C 334.99 174.26, 336.87 177.01, 340.50 179.01 C 344.13 181.02, 346.76 182.64, 352.39 182.77 C 358.02 182.89, 363.53 181.52, 368.67 179.64 C 373.80 177.76, 373.67 173.75, 378.05 173.38 C 382.44 173.00, 389.70 175.13, 390.57 177.76 C 391.45 180.39, 388.19 182.77, 382.44 186.52 C 376.68 190.28, 367.16 192.91, 361.78 196.54 C 356.40 200.17, 357.02 199.42, 355.52 204.67 C 354.02 209.93, 353.27 212.44, 354.27 222.83 C 355.27 233.22, 358.78 244.48, 360.53 256.63 C 362.28 268.77, 363.16 272.40, 363.03 283.54 C 362.91 294.68, 362.91 300.31, 359.90 312.33 C 356.90 324.35, 353.64 332.74, 348.01 343.63 C 342.38 354.52, 335.87 361.28, 331.74 366.79 C 327.60 372.30, 328.36 370.67, 327.35 371.17 C 326.35 371.67, 327.10 375.42, 326.73 369.29 C 326.35 363.16, 326.10 346.13, 325.48 340.50 C 324.85 334.87, 324.60 338.37, 323.60 341.12 C 322.60 343.88, 321.35 346.01, 320.47 354.27 C 319.59 362.53, 318.47 369.42, 319.22 382.44 C 319.97 395.45, 322.60 410.98, 324.22 419.36 C 325.85 427.75, 324.85 422.24, 327.35 424.37 C 329.86 426.50, 333.99 426.75, 336.74 430.00 C 339.50 433.26, 346.26 438.52, 341.12 440.65 C 335.99 442.77, 318.72 441.77, 311.08 440.65 C 303.44 439.52, 309.20 444.78, 302.94 435.01 C 296.68 425.25, 287.05 407.47, 279.78 391.82 C 272.52 376.18, 269.27 360.40, 266.64 356.77 C 264.01 353.14, 264.89 364.53, 266.64 373.67 C 268.39 382.81, 277.41 395.08, 275.40 402.46 C 273.40 409.85, 259.88 411.48, 256.63 410.60 C 253.37 409.73, 258.63 403.22, 259.13 398.08 C 259.63 392.95, 259.76 390.32, 259.13 384.94 C 258.50 379.56, 257.75 376.30, 256.00 371.17 C 254.25 366.04, 253.62 364.16, 250.37 359.28 C 247.11 354.39, 243.61 350.51, 239.73 346.76 C 235.85 343.00, 236.97 343.00, 230.96 340.50 C 224.95 338.00, 216.07 335.37, 209.68 334.24 C 203.30 333.11, 201.67 334.24, 199.04 334.87 C 196.41 335.49, 194.28 336.49, 196.54 337.37 C 198.79 338.25, 204.55 337.62, 210.31 339.25 C 216.07 340.87, 220.20 342.50, 225.33 345.51 C 230.46 348.51, 231.96 349.64, 235.97 354.27 C 239.98 358.90, 242.61 362.66, 245.36 368.67 C 248.11 374.67, 248.86 378.05, 249.74 384.31 C 250.62 390.57, 250.24 394.70, 249.74 399.96 C 249.24 405.22, 253.00 408.85, 247.24 410.60 C 241.48 412.35, 231.46 410.23, 220.95 408.72 C 210.43 407.22, 203.67 405.84, 194.66 403.09 C 185.65 400.34, 182.89 399.21, 175.88 394.95 C 168.87 390.70, 161.74 382.31, 159.61 381.81 C 157.48 381.31, 161.86 388.32, 165.24 392.45 C 168.62 396.58, 171.13 398.83, 176.51 402.46 C 181.89 406.09, 184.65 407.85, 192.16 410.60 C 199.67 413.36, 198.29 413.36, 214.06 416.23 C 229.84 419.11, 256.50 421.87, 271.02 425.00 C 285.54 428.13, 281.91 428.88, 286.67 431.88 C 291.43 434.89, 317.34 438.27, 294.81 440.02 C 272.27 441.77, 203.42 441.27, 174.00 440.65 C 144.59 440.02, 156.48 439.52, 147.72 436.89 C 138.95 434.26, 135.45 431.13, 130.19 427.50 C 124.93 423.87, 124.56 422.62, 121.43 418.74 C 118.30 414.86, 117.30 414.61, 114.54 408.10 C 111.79 401.59, 109.29 396.96, 107.66 386.19 C 106.03 375.42, 106.16 364.28, 106.41 354.27 C 106.66 344.25, 107.28 343.63, 108.91 336.12 C 110.54 328.61, 111.91 323.72, 114.54 316.71 C 117.17 309.70, 118.42 307.20, 122.05 301.07 C 125.68 294.93, 128.06 291.55, 132.69 286.04 C 137.33 280.54, 139.33 278.41, 145.21 273.53 C 151.10 268.64, 155.48 265.64, 162.11 261.63 C 168.75 257.63, 168.25 257.63, 178.39 253.50 C 188.53 249.37, 203.05 245.11, 212.81 240.98 C 222.58 236.85, 223.08 235.72, 227.21 232.84 C 231.34 229.96, 231.09 229.71, 233.47 226.58 C 235.85 223.45, 237.35 221.70, 239.10 217.19 C 240.85 212.69, 241.35 216.82, 242.23 204.05 C 243.11 191.28, 239.73 166.37, 243.48 153.35 C 247.24 140.33, 252.75 144.84, 261.01 138.95 C 269.27 133.07, 275.90 125.68, 284.79 123.93 C 293.68 122.18, 297.44 129.44, 305.45 130.19 C 313.46 130.94, 318.34 130.07, 324.85 127.69 C 331.36 125.31, 333.86 123.06, 338.00 118.30 C 342.13 113.54, 343.88 106.91, 345.51 103.90 C 347.13 100.90, 345.26 103.28, 346.13 103.28 Z M 364.91 70.73 C 367.41 71.23, 372.67 71.60, 376.80 73.86 C 380.93 76.11, 382.94 78.24, 385.56 82.00 C 388.19 85.75, 389.07 88.88, 389.95 92.64 C 390.82 96.39, 390.45 97.89, 389.95 100.77 C 389.45 103.65, 389.70 104.65, 387.44 107.03 C 385.19 109.41, 382.18 111.66, 378.68 112.67 C 375.17 113.67, 374.05 113.79, 369.92 112.04 C 365.79 110.29, 361.91 108.28, 358.02 103.90 C 354.14 99.52, 353.64 92.89, 350.51 90.13 C 347.38 87.38, 344.88 89.63, 342.38 90.13 C 339.87 90.63, 338.75 89.88, 338.00 92.64 C 337.24 95.39, 339.12 100.15, 338.62 103.90 C 338.12 107.66, 337.74 108.41, 335.49 111.41 C 333.24 114.42, 330.98 116.92, 327.35 118.92 C 323.72 120.93, 320.97 121.18, 317.34 121.43 C 313.71 121.68, 312.21 121.18, 309.20 120.18 C 306.20 119.17, 304.82 118.42, 302.32 116.42 C 299.81 114.42, 298.44 112.79, 296.68 110.16 C 294.93 107.53, 294.18 107.03, 293.56 103.28 C 292.93 99.52, 293.05 94.89, 293.56 91.38 C 294.06 87.88, 294.18 88.25, 296.06 85.75 C 297.94 83.25, 299.94 80.87, 302.94 78.87 C 305.95 76.86, 307.95 76.36, 311.08 75.74 C 314.21 75.11, 315.34 75.11, 318.59 75.74 C 321.85 76.36, 324.35 77.11, 327.35 78.87 C 330.36 80.62, 328.86 83.75, 333.61 84.50 C 338.37 85.25, 346.13 85.00, 351.14 82.62 C 356.15 80.24, 356.02 74.86, 358.65 72.61 C 361.28 70.35, 363.03 71.73, 364.28 71.35 C 365.54 70.98, 362.41 70.23, 364.91 70.73 Z M 355.52 348.64 C 354.64 355.90, 351.39 371.79, 350.51 385.56 C 349.64 399.33, 350.39 409.98, 351.14 417.49 C 351.89 425.00, 352.52 421.49, 354.27 423.12 C 356.02 424.75, 357.52 423.87, 359.90 425.62 C 362.28 427.38, 364.53 428.88, 366.16 431.88 C 367.79 434.89, 371.29 438.89, 368.04 440.65 C 364.78 442.40, 354.52 443.27, 349.89 440.65 C 345.26 438.02, 348.26 432.13, 344.88 427.50 C 341.50 422.87, 335.99 422.37, 332.99 417.49 C 329.98 412.60, 330.73 409.98, 329.86 403.09 C 328.98 396.21, 325.48 390.82, 328.61 383.06 C 331.74 375.30, 340.25 371.04, 345.51 364.28 C 350.76 357.52, 352.89 352.39, 354.89 349.26 C 356.90 346.13, 356.40 341.38, 355.52 348.64 Z M 287.92 87.63 C 286.54 90.01, 282.29 95.89, 280.41 100.15 C 278.53 104.40, 285.04 102.53, 278.53 108.91 C 272.02 115.29, 254.87 127.81, 247.86 132.07 C 240.85 136.32, 245.73 132.19, 243.48 130.19 C 241.23 128.19, 238.10 125.56, 236.60 122.05 C 235.09 118.55, 235.47 115.79, 235.97 112.67 C 236.47 109.54, 236.60 108.66, 239.10 106.41 C 241.60 104.15, 245.23 102.27, 248.49 101.40 C 251.74 100.52, 252.87 101.27, 255.37 102.02 C 257.88 102.78, 257.13 106.78, 261.01 105.15 C 264.89 103.53, 269.52 97.27, 274.78 93.89 C 280.04 90.51, 284.67 89.51, 287.30 88.25 C 289.92 87.00, 289.30 85.25, 287.92 87.63 Z M 318.59 82.00 C 316.46 82.12, 311.96 81.24, 308.58 82.62 C 305.20 84.00, 303.44 86.75, 301.69 88.88 C 299.94 91.01, 300.19 90.88, 299.81 93.26 C 299.44 95.64, 299.31 98.14, 299.81 100.77 C 300.31 103.40, 299.69 103.65, 302.32 106.41 C 304.95 109.16, 308.58 113.17, 312.96 114.54 C 317.34 115.92, 320.84 114.54, 324.22 113.29 C 327.60 112.04, 328.23 110.41, 329.86 108.28 C 331.49 106.16, 332.24 106.28, 332.36 102.65 C 332.49 99.02, 331.74 93.64, 330.48 90.13 C 329.23 86.63, 328.36 86.75, 326.10 85.12 C 323.85 83.50, 320.72 82.62, 319.22 82.00 C 317.72 81.37, 320.72 81.87, 318.59 82.00 Z M 369.29 76.36 C 368.16 76.36, 366.16 75.74, 364.28 76.36 C 362.41 76.99, 361.15 76.74, 359.90 79.49 C 358.65 82.25, 357.52 86.25, 358.02 90.13 C 358.53 94.01, 359.28 95.64, 362.41 98.89 C 365.54 102.15, 370.04 105.03, 373.67 106.41 C 377.30 107.78, 378.55 106.53, 380.56 105.78 C 382.56 105.03, 382.69 105.03, 383.69 102.65 C 384.69 100.27, 386.07 97.64, 385.56 93.89 C 385.06 90.13, 383.06 86.88, 381.18 83.87 C 379.31 80.87, 378.43 80.37, 376.18 78.87 C 373.92 77.36, 371.29 76.86, 369.92 76.36 C 368.54 75.86, 370.42 76.36, 369.29 76.36 Z M 327.98 132.69 C 326.73 132.94, 324.22 132.44, 322.35 133.95 C 320.47 135.45, 319.09 137.95, 318.59 140.21 C 318.09 142.46, 318.72 143.46, 319.84 145.21 C 320.97 146.97, 322.22 148.22, 324.22 148.97 C 326.23 149.72, 327.60 150.09, 329.86 148.97 C 332.11 147.84, 334.62 145.96, 335.49 143.33 C 336.37 140.71, 335.62 137.95, 334.24 135.82 C 332.86 133.70, 329.86 133.32, 328.61 132.69 C 327.35 132.07, 329.23 132.44, 327.98 132.69 Z\"/>";
const DEFAULT_FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512"><rect width="512" height="512" rx="104" fill="#BE3609"/>${CODEOTTER_PATH_TAG}</svg>`;
const readJson = (req) =>
  new Promise((ok, err) => {
    let b = "";
    req.on("data", (d) => { b += d; if (b.length > 1e6) { req.destroy(); err(new Error("Request body too large")); } }).on("end", () => { try { ok(b ? JSON.parse(b) : {}); } catch (e) { err(e); } }).on("error", err);
  });

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
http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const json = (o) => (res.setHeader("content-type", "application/json"), res.end(JSON.stringify(o)));
    try {
      // Cross-site requests never reach the API (defence in depth on top of SameSite=Lax cookies).
      if ((url.pathname.startsWith("/api/") || url.pathname === "/score") && req.headers["sec-fetch-site"] === "cross-site") { res.statusCode = 403; return json({ error: "Cross-site request refused" }); }
      const hook = url.pathname.match(/^\/webhooks\/(github|forgejo|gitea|bitbucket|bitbucketdc|azure)$/);
      if (hook) {
        if (req.method !== "POST") { res.statusCode = 405; return json({ error: "POST only" }); }
        return handleWebhook(req, res, hook[1]);
      }
      if (url.pathname === "/api/reviews") {
        const g = await gate(req, res, "review");
        if (!g.ok) return;
        const c = await llmConfig();
        const rs = await visibleRepos(g);
        const org = requestOrg(url);
        const scoped = rs.filter((r) => !org || r.startsWith(`${org}/`));
        const onboardingComplete = (await store.getSetting("onboardingComplete")) === true;
        const onboardingNeeded = seesAll(g) && !onboardingComplete && rs.length === 0;
        const reviewed = (await store.all()).filter((r) => (!org || repoOf(r.pr).startsWith(`${org}/`)) && (seesAll(g) || rs.includes(repoOf(r.pr))));
        return json({ repo: scoped[0] || "", repos: rs, onboardingNeeded, forgejoUrl: FORGES.forgejo.url, forgeUrls: Object.fromEntries(Object.entries(FORGES).map(([id, f]) => [id, f.url])), model: `${c.provider}/${c.model}`, baseUrl: seesAll(g) ? c.baseUrl : "", store: PB_URL ? "pocketbase" : "files", update: availableUpdate(), settingsPages: await settingsPages(g.user), reviewed, open: (await Promise.all(scoped.map(openPrs))).flat() });
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
              await ghAsync("repo", "list", "--limit", "1", "--json", "nameWithOwner");
              return json({ ok: true, message: "Connected via GitHub CLI" });
            } catch (err) {
              return json({ ok: false, error: err.message });
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
              return json({ ok: true, message: await makeForge(provider, draft).test() });
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
          const before = await repos();
          await store.setSetting("repos", nextRepos);
          reposChanged(before, nextRepos).catch((e) => console.warn(`[repos] ${e.message}`));
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
        const g = await gate(req, res, "review");
        if (!g.ok) return;
        const org = url.searchParams.get("org") || "";
        if (org && !OWNER_RE.test(org)) throw new Error("Bad organization");
        return json(await homeData(org, g));
      }
      if (url.pathname === "/api/login") {
        // Showcase content for the login page's right column: showcase.json next to the server, editable without code.
        const file = join(import.meta.dirname, "showcase.json");
        const showcase = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { headline: "Code Otter", sub: "", groups: [] };
        let providers = [];
        if (PB_URL) { try { const m = await store.authMethods(); providers = Object.entries(LOGIN_PROVIDERS).filter(([, spec]) => m.oauth2?.enabled && m.oauth2.providers.some((p) => p.name === spec.pb)).map(([id, spec]) => ({ id, label: spec.label })); } catch {} }
        return json({ showcase, signInAvailable: !!PB_URL, configured: providers.length > 0, providers });
      }
      if (url.pathname === "/healthz") {
        // Liveness stays 200 (a PocketBase restart must not restart this container too); storage health is reported alongside.
        const storage = PB_URL ? await fetch(`${PB_URL}/api/health`, { signal: AbortSignal.timeout(2000) }).then((r) => r.ok).catch(() => false) : existsSync(SCORES);
        return json({ ok: true, version: VERSION, storage: { kind: PB_URL ? "pocketbase" : "files", ok: storage } });
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
        if (!gh) throw new Error(`${spec.label} sign-in is not configured: open Admin / Auth providers`);
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
          // First account: owner. Later ones need an invite; an uninvited account is deleted again, never left usable.
          // Microsoft: the directory's mail (or UPN), trusted only while the app is pinned to one tenant
          let entraEmail = "";
          if (flow.provider === "microsoft") {
            const p = (await store.getOAuth()).providers.find((x) => x.name === "microsoft");
            if (ENTRA_TENANT_RE.test(entraTenant(p))) entraEmail = String(auth.meta?.email || auth.meta?.rawUser?.mail || auth.meta?.rawUser?.userPrincipalName || "");
          }
          if (!(await admit(auth.record, [flow.provider], auth.meta?.username, entraEmail))) {
            await store.deleteUser(auth.record.id).catch((e) => console.error(`Could not delete uninvited account ${auth.record.id}: ${e.message}`));
            return fail(NOT_INVITED);
          }
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
        const returnTo = cookies(req).pr_manifest_return || "/settings/git";
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
          webhookSecret: app.webhook_secret || "",
        });
        if (app.owner?.login) {
          await store.setSetting("githubOwner", app.owner.login);
        }
        setCookie(res, "pr_manifest", "", 0);
        setCookie(res, "pr_manifest_return", "", 0);
        forgetGithubRepos();
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
        const g = await gate(req, res, page.access === "owner" ? "owner" : "admin"); // settings pages are never below admin
        if (!g.ok) return;
        const user = g.user;
        if (m[2] && req.method !== "POST") { res.statusCode = 405; return json({ error: "POST only" }); }
        if (m[2] === "test") return json(await page.test());
        if (m[2]) {
          const action = page.actions?.[m[2]];
          if (!action) throw new Error(`No action ${m[2]} on ${m[1]}`);
          return json(await action(req, res, await readJson(req)));
        }
        const scope = { org: url.searchParams.get("org") || "", repo: url.searchParams.get("repo") || "" };
        if (scope.org && !OWNER_RE.test(scope.org)) throw new Error("Bad organization");
        if (scope.repo) await onboardedRepo(scope.repo, scope.org);
        if (req.method === "POST") await page.save(await readJson(req), scope, user);
        return json(await page.load(scope, user));
      }
      if (url.pathname === "/api/learnings" && req.method === "POST") {
        const g = await gate(req, res, "review");
        if (!g.ok) return;
        const body = await readJson(req);
        const prUrl = String(body.prUrl || "").trim();
        const repo = String(body.repo || (prUrl ? repoOf({ url: prUrl }) : "")).trim();
        checkRepoScope(repo, requestOrg(url));
        if (prUrl && repoOf({ url: prUrl }) !== repo) throw new Error("PR and repository mismatch");
        await assertRepo(g, repo);
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
        const g = await gate(req, res, "review");
        if (!g.ok) return;
        if (req.method !== "POST") return json(Object.entries(PR_TOOLS).map(([id, t]) => ({ id, label: t.label, input: t.input || null, apply: t.applyLabel || null })));
        const body = await readJson(req);
        const prUrl = String(body.prUrl || "").trim();
        if (!validPrUrl(prUrl)) throw new Error("Invalid pull request URL");
        checkRepoScope(repoOf({ url: prUrl }), requestOrg(url));
        await assertRepo(g, repoOf({ url: prUrl }));
        return json(await runPrTool(prUrl, String(body.tool || ""), { question: body.question, action: String(body.action || "run") }));
      }
      if (url.pathname === "/api/review-suggestions" && req.method === "POST") {
        const g = await gate(req, res, "review");
        if (!g.ok) return;
        const body = await readJson(req);
        const prUrl = String(body.prUrl || "").trim();
        if (!prUrl || !validPrUrl(prUrl)) throw new Error("Invalid pull request URL");
        const repo = String(body.repo || repoOf({ url: prUrl })).trim();
        checkRepoScope(repo, requestOrg(url));
        if (repoOf({ url: prUrl }) !== repo) throw new Error("PR and repository mismatch");
        await assertRepo(g, repo);
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
        const g = await gate(req, res, "review");
        if (!g.ok) return;
        const org = requestOrg(url);
        const results = (await store.getSetting("triageResults")) || {};
        const ref = (url.searchParams.get("pr") || "").trim();
        if (!ref) {
          const mine = seesAll(g) ? null : await visibleRepos(g);
          return json(Object.values(results).filter((t) => { try { checkRepoScope(t.repo, org); return !mine || mine.includes(t.repo); } catch { return false; } }));
        }
        const resolved = await resolvePr(ref, url.searchParams.get("repo") || "");
        checkRepoScope(parsePrUrl(resolved.urlGuess).repo, org);
        await assertRepo(g, parsePrUrl(resolved.urlGuess).repo);
        if (req.method === "POST") return json(await triagePr(ref, url.searchParams.get("repo") || ""));
        return json(results[resolved.urlGuess] || null);
      }
      if (url.pathname === "/api/score" || (url.pathname === "/score" && url.searchParams.get("pr"))) {
        const g = await gate(req, res, "review");
        if (!g.ok) return;
        const ref = (url.searchParams.get("pr") || "").trim();
        if (!ref) throw new Error("Missing pr");
        const force = url.searchParams.has("force");
        const repo = url.searchParams.get("repo") || "";
        const resolved = await resolvePr(ref, repo);
        checkRepoScope(parsePrUrl(resolved.urlGuess).repo, requestOrg(url));
        await assertRepo(g, parsePrUrl(resolved.urlGuess).repo);
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
        const file = [join(DIST, "favicon.svg"), join(ROOT, "web", "public", "favicon.svg")].find(existsSync);
        res.setHeader("content-type", "image/svg+xml; charset=utf-8");
        res.setHeader("cache-control", "public, max-age=86400");
        if (file) return res.end(readFileSync(file));
        return res.end(DEFAULT_FAVICON_SVG);
      }
      if (url.pathname === "/og.svg") {
        const prParam = (url.searchParams.get("pr") || "").trim();
        const cachedPr = validPrUrl(prParam) ? await store.get(prParam).catch(() => null) : null;
        if (cachedPr && (await developerBlocked(req, repoOf(cachedPr.pr)))) { res.statusCode = 403; return json({ error: "Repository is not assigned to your account" }); }
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
          const ref = (url.searchParams.get("pr") || "").trim();
          const cPr = validPrUrl(ref) ? await store.get(ref).catch(() => null) : null;
          if (cPr?.pr && !(await developerBlocked(req, repoOf(cPr.pr)))) {
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
            const sec = sp.group === "workspace" ? "Workspace" : "System";
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
      res.statusCode = e.status === 403 ? 403 : 500;
      const detail = e.cause ? ` (${e.cause.code || e.cause.message || e.cause})` : "";
      const msg = e.message === "fetch failed" ? `Fetch failed: connection error or endpoint unreachable${detail}` : `${e.message}${detail}`;
      console.error(`[API Error] ${req.method} ${url.pathname}:`, e.stack || e);
      json({ error: msg });
    }
  })
  .setTimeout(0) // Node cuts requests at 300 s by default; a cold local sidecar plus a long review can take longer
  .on("error", (e) => {
    console.error(e.code === "EADDRINUSE" ? `Port ${PORT} is already in use (set PORT to pick another)` : `Cannot listen on ${PORT}: ${e.message}`);
    process.exit(1);
  })
  .listen(PORT, async () => {
    console.log(`CodeOtter on http://localhost:${PORT} (repo ${REPO}, model ${(await llmConfig()).model}, store ${PB_URL ? `PocketBase ${PB_URL}` : "scores/"})`);
    syncForwarders().catch((e) => console.warn(`[forwarder] ${e.message}`));
    redeliverGitHubFailures().catch((e) => console.warn(`[webhook github] redelivery: ${e.message}`));
  });
}
