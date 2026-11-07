// Storage: PocketBase when PB_URL is set (started here when its binary is present), else JSON files.
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { CODEOTTER_HOME, IS_SERVER } from "./config.mjs";
import { repoOf } from "./views.mjs";

// Store: PocketBase when PB_URL is set (the Docker image sets it, or auto-detected locally), plain JSON files in scores/ otherwise.
function findPocketBase() {
  const isWin = process.platform === "win32";
  const binaryName = isWin ? "pocketbase.exe" : "pocketbase";
  const candidates = [
    join(CODEOTTER_HOME, ".pb", binaryName),
    join(CODEOTTER_HOME, binaryName),
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
export const PB_URL = process.env.PB_URL || (pbBinAvailable ? "http://127.0.0.1:8090" : "");
export const SCORES = join(CODEOTTER_HOME, "scores");
const CONFIG = join(CODEOTTER_HOME, "config.json");
// <file-store>
const readConfig = () => (existsSync(CONFIG) ? JSON.parse(readFileSync(CONFIG, "utf8")) : {});
// Write to a sibling file and rename: a crash mid-write never leaves half a JSON document behind.
const writeJsonAtomic = (file, value) => { const tmp = `${file}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify(value, null, 2)); renameSync(tmp, file); };
// Settings are whole objects read, modified and written back; poll loops and web saves run them one at a time.
let settingsChain = Promise.resolve();
const withSettingsLock = (fn) => { const run = settingsChain.then(fn, fn); settingsChain = run.catch(() => {}); return run; };
const readJsonFileOrNull = (file) => { try { return JSON.parse(readFileSync(file, "utf8")); } catch (e) { console.warn(`[store] skipping unreadable ${file}: ${e.message}`); return null; } };
const keyOf = (url) => /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/.test(url)
  ? url.replace("https://github.com/", "").replace(/\//g, "-")
  : createHash("sha256").update(url).digest("hex");
const fileStore = {
  init: async () => mkdirSync(SCORES, { recursive: true }),
  get: async (url) => {
    const f = join(SCORES, `${keyOf(url)}.json`);
    return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null;
  },
  put: async (r) => writeJsonAtomic(join(SCORES, `${keyOf(r.pr.url)}.json`), r),
  getSetting: async (key) => readConfig()[key] ?? null,
  setSetting: (key, value) => withSettingsLock(async () => writeJsonAtomic(CONFIG, { ...readConfig(), [key]: value })),
  all: async () =>
    (existsSync(SCORES) ? readdirSync(SCORES) : [])
      .filter((f) => f.endsWith(".json"))
      .map((f) => readJsonFileOrNull(join(SCORES, f)))
      .filter((r) => r && r.pr && typeof r.at === "string")
      .sort((a, b) => b.at.localeCompare(a.at)),
  reviews() {
    return this.all();
  },
};
// </file-store>

let pbProc = null;
let pbStarting;
function ensurePocketBase() {
  return pbStarting ||= startPocketBase().finally(() => { pbStarting = null; });
}
async function startPocketBase() {
  if (!PB_URL) return;
  const pbBin = findPocketBase();
  // Check if PocketBase is already running
  const reachable = await fetch(`${PB_URL}/api/health`, { signal: AbortSignal.timeout(1000) })
    .then((r) => r.ok)
    .catch(() => false);
  if (reachable) return;
  if (!pbBin) return;
  // An unreachable remote database must never start a local replacement.
  const url = new URL(PB_URL);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return;

  const dir = join(CODEOTTER_HOME, "pb_data");
  const migrationsDir = join(import.meta.dirname, "pb_migrations");
  mkdirSync(dir, { recursive: true });

  const adminEmail = process.env.PB_ADMIN_EMAIL || "admin@example.com";
  const adminPassword = process.env.PB_ADMIN_PASSWORD || "change-me-please";

  try {
    execFileSync(pbBin, ["superuser", "upsert", adminEmail, adminPassword, "--dir", dir, "--migrationsDir", migrationsDir], { stdio: "ignore" });
  } catch {}

  const hostPort = `${url.hostname}:${url.port || "8090"}`;
  pbProc = spawn(pbBin, ["serve", `--http=${hostPort}`, "--dir", dir, "--migrationsDir", migrationsDir], { stdio: "ignore", detached: !IS_SERVER, windowsHide: true });
  let startError;
  pbProc.once("error", error => { startError = error; });
  if (!IS_SERVER) pbProc.unref();

  const killPb = () => { if (pbProc) { try { pbProc.kill(); } catch {} pbProc = null; } };
  if (IS_SERVER) {
    process.once("exit", killPb);
    process.once("SIGINT", () => { killPb(); process.exit(); });
    process.once("SIGTERM", () => { killPb(); process.exit(); });
  }

  for (let i = 0; i < 20; i++) {
    if (startError) throw new Error(`Could not start PocketBase: ${startError.message}`);
    const ok = await fetch(`${PB_URL}/api/health`, { signal: AbortSignal.timeout(1000) })
      .then((r) => r.ok)
      .catch(() => false);
    if (ok) {
      if (IS_SERVER) console.log(`PocketBase auto-started at ${PB_URL}`);
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
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`PocketBase auth ${res.status}: ${(await res.text()).slice(0, 300)}`);
  pbToken = (await res.json()).token;
}
async function pb(path, init = {}, retry = true) {
  let res;
  try {
    res = await fetch(`${PB_URL}/api/${path}`, { ...init, headers: { "content-type": "application/json", authorization: pbToken }, signal: AbortSignal.timeout(10000) });
  } catch (error) {
    // Only retry reads: a failed write may already have reached the database.
    const refused = error.cause?.code === "ECONNREFUSED" || error.cause?.errors?.some(e => e.code === "ECONNREFUSED");
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(new URL(PB_URL).hostname);
    if (retry && refused && local && pbBinAvailable && (init.method || "GET").toUpperCase() === "GET") {
      await ensurePocketBase();
      await pbAuth();
      return pb(path, init, false);
    }
    throw new Error(`Cannot reach PocketBase at ${PB_URL}: ${error.cause?.code || error.message}`, { cause: error });
  }
  if (res.status === 401 && retry) return pbAuth().then(() => pb(path, init, false));
  if (!res.ok) throw new Error(`Storage ${res.status}: ${pbError(await res.text())}`);
  return res.status === 204 ? null : res.json();
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
// The filter is a string: a quote or backslash in the key would change its meaning, and no PR URL or setting key has one.
// <pb-filter>
const pbFilterEq = (field, value) => { if (/["\\]/.test(value)) throw new Error(`Invalid ${field}`); return encodeURIComponent(`${field}="${value}"`); };
const pbFind = async (url) => (await pb(`collections/reviews/records?perPage=1&filter=${pbFilterEq("url", String(url))}`)).items[0];
// </pb-filter>
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
  // Page through: a flat perPage=500 silently dropped the oldest reviews once an installation outgrew it.
  async all() {
    const out = [];
    for (let page = 1; page <= 40; page++) {
      const r = await pb(`collections/reviews/records?perPage=500&page=${page}&sort=-at`);
      out.push(...r.items.map((i) => i.data));
      if (page >= (r.totalPages || 1)) break;
    }
    return out;
  },
  reviews() {
    return this.all();
  },
  getOAuth: async () => (await pb("collections/users")).oauth2,
  hasForgeIdentities: async (provider) => (await pb(`collections/_externalAuths/records?perPage=1&filter=${pbFilterEq("provider", String(provider))}`)).items.length > 0,
  // Sign-in: PocketBase's manual OAuth2 flow. No superuser token involved; these are public user endpoints.
  async authMethods() {
    const res = await fetch(`${PB_URL}/api/collections/users/auth-methods`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`Storage ${res.status}: ${pbError(await res.text())}`);
    return res.json();
  },
  async authWithOAuth2(body) {
    const res = await fetch(`${PB_URL}/api/collections/users/auth-with-oauth2`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`Sign-in failed: ${pbError(await res.text())}`);
    return res.json();
  },
  async authRefresh(token) {
    const res = await fetch(`${PB_URL}/api/collections/users/auth-refresh`, { method: "POST", headers: { authorization: token }, signal: AbortSignal.timeout(10000) });
    return res.ok ? res.json() : null;
  },
  userFile: (id, file) => fetch(`${PB_URL}/api/files/users/${id}/${file}`, { signal: AbortSignal.timeout(10000) }),
  users: async () => (await pb("collections/users/records?perPage=200&sort=created")).items,
  setRole: (id, role) => pb(`collections/users/records/${id}`, { method: "PATCH", body: JSON.stringify({ role }) }),
  // PocketBase provider names (github, oidc, gitea) linked to an account, from its OAuth identities.
  identities: async (id) => (await pb(`collections/_externalAuths/records?perPage=50&filter=${pbFilterEq("recordRef", String(id))}`)).items.map((i) => i.provider),
  deleteUser: (id) => pb(`collections/users/records/${encodeURIComponent(id)}`, { method: "DELETE" }),
  setOAuth: async (oauth2) => pb("collections/users", { method: "PATCH", body: JSON.stringify({ oauth2 }) }),
  getSetting: async (key) => (await pb(`collections/settings/records?perPage=1&filter=${pbFilterEq("key", String(key))}`)).items[0]?.value ?? null,
  setSetting: (key, value) => withSettingsLock(async () => {
    const hit = (await pb(`collections/settings/records?perPage=1&filter=${pbFilterEq("key", String(key))}`)).items[0];
    await pb(hit ? `collections/settings/records/${hit.id}` : "collections/settings/records", { method: hit ? "PATCH" : "POST", body: JSON.stringify({ key, value }) });
  }),
};
export const store = PB_URL ? pbStore : fileStore;
