// Storage: PocketBase when PB_URL is set (started here when its binary is present), else JSON files.
import { execFileSync, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { CODEOTTER_HOME, IS_SERVER } from "./config.ts";
import { repoOf } from "./views.ts";
import type { Role } from "./access.ts";
import type { ReviewRecord } from "./review.ts";
import type { ReviewSettings } from "./context.ts";

// Settings: one JSON value per key. The types are what this app writes; a missing key reads as null. Keys not listed
// here (dynamic ones such as a forge id) read as unknown and the caller narrows.
export interface Invite { id: string; provider: string; pb: string; login: string; role: Role; repos?: string[]; at?: string }
export interface GithubAppSetting { id?: number | string; slug?: string; owner?: string; pem?: string; clientId?: string; clientSecret?: string; webhookSecret?: string; forwardSecret?: string; actionSecret?: string }
export interface ModelSetting { provider?: string; model?: string; apiKey?: string; baseUrl?: string }
export interface TriageSetting { auto: boolean; stopAt: number }
export interface TriageResult { url: string; repo: string; headSha: string; at: string }
export interface ReviewFailure { sha: string; at: number; tries: number; error: string }
export interface WebhookDelivery { at: number; event: string; delivery: string }
export interface GuideSetting { use?: boolean; learnings?: string[] }
export interface RepoSetting { review?: Partial<ReviewSettings>; learnings?: string[]; accepted?: string[] }
export interface SettingsMap {
  access: Record<string, string[]>;
  invites: Invite[];
  repos: string[];
  guides: Record<string, GuideSetting>;
  repoSettings: Record<string, RepoSetting>;
  review: Record<string, unknown>;
  llm: ModelSetting;
  s1: ModelSetting;
  triage: TriageSetting;
  triageResults: Record<string, TriageResult>;
  autoReviewed: Record<string, string>;
  autoReviewFailed: Record<string, ReviewFailure>;
  commandsSeen: Record<string, string>;
  webhookStatus: Record<string, WebhookDelivery>;
  webhookForward: boolean;
  githubApp: GithubAppSetting;
  githubToken: string;
  githubOwner: string;
  primaryProvider: string;
  onboardingComplete: boolean;
  runtimeDevices: Record<string, { device: string; model: string }>;
  [webhook: `${string}Webhook`]: { secret?: string };
  [origin: `${string}Origin`]: string;
}
export type SettingKey = keyof SettingsMap;
export type SettingValue<K extends string> = K extends SettingKey ? SettingsMap[K] : unknown;
// PocketBase records and auth payloads this app reads.
export interface UserRecord { id: string; name?: string; username?: string; email?: string; role?: Role | ""; avatar?: string; verified?: boolean; created?: string }
export interface OAuthProviderConfig { name: string; clientId?: string; clientSecret?: string; displayName?: string; authURL?: string; tokenURL?: string; userInfoURL?: string; pkce?: boolean }
export interface OAuthConfig { enabled?: boolean; providers: OAuthProviderConfig[] }
export interface AuthMethodProvider { name: string; state?: string; codeVerifier?: string; authURL?: string }
export interface AuthMethods { oauth2?: { enabled?: boolean; providers: AuthMethodProvider[] } }
export interface AuthResult { token: string; record: UserRecord; meta?: { email?: string; username?: string; rawUser?: Record<string, unknown> } }
export interface OAuth2Body { provider: string; code: string; codeVerifier?: string; redirectURL: string }
// The two stores share these; the PocketBase-only methods (accounts, sign-in) are reached only behind a PB_URL check.
export interface BaseStore {
  init(): Promise<unknown>;
  get(url: string): Promise<ReviewRecord | null>;
  put(r: ReviewRecord): Promise<void>;
  getSetting<K extends string>(key: K): Promise<SettingValue<K> | null>;
  setSetting<K extends string>(key: K, value: SettingValue<K>): Promise<void>;
  all(): Promise<ReviewRecord[]>;
  reviews(): Promise<ReviewRecord[]>;
}
export interface PbStore extends BaseStore {
  getOAuth(): Promise<OAuthConfig>;
  hasForgeIdentities(provider: string): Promise<boolean>;
  authMethods(): Promise<AuthMethods>;
  authWithOAuth2(body: OAuth2Body): Promise<AuthResult>;
  authRefresh(token: string): Promise<AuthResult | null>;
  userFile(id: string, file: string): Promise<Response>;
  users(): Promise<UserRecord[]>;
  setRole(id: string, role: Role): Promise<unknown>;
  identities(id: string): Promise<string[]>;
  deleteUser(id: string): Promise<unknown>;
  setOAuth(oauth2: OAuthConfig): Promise<unknown>;
}
export type Store = PbStore;

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
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const readConfig = (): Record<string, unknown> => (existsSync(CONFIG) ? JSON.parse(readFileSync(CONFIG, "utf8")) : {});
// Write to a sibling file and rename: a crash mid-write never leaves half a JSON document behind.
const writeJsonAtomic = (file: string, value: unknown) => { const tmp = `${file}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify(value, null, 2)); renameSync(tmp, file); };
// Settings are whole objects read, modified and written back; poll loops and web saves run them one at a time.
let settingsChain: Promise<unknown> = Promise.resolve();
const withSettingsLock = <T>(fn: () => Promise<T>): Promise<T> => { const run = settingsChain.then(fn, fn); settingsChain = run.catch(() => {}); return run; };
const readJsonFileOrNull = (file: string): unknown => { try { return JSON.parse(readFileSync(file, "utf8")); } catch (e) { console.warn(`[store] skipping unreadable ${file}: ${(e as Error).message}`); return null; } };
const keyOf = (url: string) => /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/.test(url)
  ? url.replace("https://github.com/", "").replace(/\//g, "-")
  : createHash("sha256").update(url).digest("hex");
const fileStore: BaseStore = {
  init: async () => mkdirSync(SCORES, { recursive: true }),
  get: async (url) => {
    const f = join(SCORES, `${keyOf(url)}.json`);
    return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null;
  },
  put: async (r) => writeJsonAtomic(join(SCORES, `${keyOf(r.pr.url)}.json`), r),
  // The stored value is this app's own JSON: typed by SettingsMap, not validated.
  getSetting: async <K extends string>(key: K) => (readConfig()[key] ?? null) as SettingValue<K> | null,
  setSetting: (key, value) => withSettingsLock(async () => writeJsonAtomic(CONFIG, { ...readConfig(), [key]: value })),
  all: async () =>
    (existsSync(SCORES) ? readdirSync(SCORES) : [])
      .filter((f) => f.endsWith(".json"))
      .map((f) => readJsonFileOrNull(join(SCORES, f)))
      .filter((r): r is ReviewRecord => isObj(r) && !!r.pr && typeof r.at === "string")
      .sort((a, b) => b.at.localeCompare(a.at)),
  reviews() {
    return this.all();
  },
};
// </file-store>
// A PocketBase list response's items (an empty list for anything else).
const pbItems = (x: unknown): Record<string, unknown>[] => (isObj(x) && Array.isArray(x.items) ? x.items.filter(isObj) : []);
const optStr = (x: unknown) => x === undefined || typeof x === "string";
const isReviewRecord = (x: unknown): x is ReviewRecord => isObj(x) && isObj(x.pr) && typeof x.at === "string";
const isUserRecord = (x: unknown): x is UserRecord => isObj(x) && typeof x.id === "string" && ["name", "username", "email", "role", "avatar"].every((k) => optStr(x[k]));
const hasNamedList = (x: unknown) => isObj(x) && Array.isArray(x.providers) && x.providers.every((p) => isObj(p) && typeof p.name === "string");
const isOAuthConfig = (x: unknown): x is OAuthConfig => hasNamedList(x);
const isAuthMethods = (x: unknown): x is AuthMethods => isObj(x) && (x.oauth2 === undefined || hasNamedList(x.oauth2));
const isAuthResult = (x: unknown): x is AuthResult => isObj(x) && typeof x.token === "string" && isUserRecord(x.record);

let pbProc: ChildProcess | null = null;
let pbStarting: Promise<void> | null | undefined;
function ensurePocketBase(): Promise<void> {
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
  let startError = undefined as Error | undefined; // set by the "error" listener below
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
  const j: unknown = await res.json();
  pbToken = isObj(j) && typeof j.token === "string" ? j.token : "";
}
async function pb(path: string, init: RequestInit = {}, retry = true): Promise<unknown> {
  let res;
  try {
    res = await fetch(`${PB_URL}/api/${path}`, { ...init, headers: { "content-type": "application/json", authorization: pbToken }, signal: AbortSignal.timeout(10000) });
  } catch (error) {
    // Only retry reads: a failed write may already have reached the database.
    const cause = error instanceof Error && isObj(error.cause) ? error.cause : undefined;
    const refused = cause?.code === "ECONNREFUSED" || (Array.isArray(cause?.errors) && cause.errors.some(e => isObj(e) && e.code === "ECONNREFUSED"));
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(new URL(PB_URL).hostname);
    if (retry && refused && local && pbBinAvailable && (init.method || "GET").toUpperCase() === "GET") {
      await ensurePocketBase();
      await pbAuth();
      return pb(path, init, false);
    }
    throw new Error(`Cannot reach PocketBase at ${PB_URL}: ${cause?.code || (error instanceof Error ? error.message : String(error))}`, { cause: error });
  }
  if (res.status === 401 && retry) return pbAuth().then(() => pb(path, init, false));
  if (!res.ok) throw new Error(`Storage ${res.status}: ${pbError(await res.text())}`);
  return res.status === 204 ? null : res.json();
}
// PocketBase validation errors nest as {data:{field:{sub:{code,message}}}}; surface "field.sub: message".
function pbError(text: string): string {
  try {
    const j: unknown = JSON.parse(text);
    if (!isObj(j)) return text.slice(0, 300);
    const leaves = (o: unknown, path: string[] = []): [string, unknown][] => (o && typeof o === "object" && !("code" in o) ? Object.entries(o).flatMap(([k, v]) => leaves(v, [...path, k])) : [[path.join("."), isObj(o) ? o.message : undefined]]);
    const [first] = leaves(j.data || {});
    return String(j.message) + (first?.[1] ? ` ${first[0]}: ${first[1]}` : "");
  } catch {
    return text.slice(0, 300);
  }
}
// The filter is a string: a quote or backslash in the key would change its meaning, and no PR URL or setting key has one.
// <pb-filter>
const pbFilterEq = (field: string, value: string) => { if (/["\\]/.test(value)) throw new Error(`Invalid ${field}`); return encodeURIComponent(`${field}="${value}"`); };
const pbFind = async (url: string) => pbItems(await pb(`collections/reviews/records?perPage=1&filter=${pbFilterEq("url", String(url))}`))[0];
// </pb-filter>
const pbStore: PbStore = {
  async init() {
    await ensurePocketBase();
    for (let i = 0; ; i++) {
      try {
        await pbAuth();
        break;
      } catch (e) {
        if (i >= 30) throw new Error(`Cannot reach PocketBase at ${PB_URL} (check PB_URL, PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD): ${e instanceof Error ? e.message : String(e)}`);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    // one-off import of reviews left in scores/ from before PocketBase
    for (const r of await fileStore.all()) if (!(await pbFind(r.pr.url))) await this.put(r);
  },
  get: async (url) => { const d = (await pbFind(url))?.data; return isReviewRecord(d) ? d : null; },
  async put(r) {
    const body = JSON.stringify({ url: r.pr.url, repo: repoOf(r.pr), number: r.pr.number, title: r.pr.title, verdict: r.review.verdict, quality: r.review.scores.quality, blast: r.blast.score, model: r.model, at: r.at, data: r });
    const hit = await pbFind(r.pr.url);
    await pb(hit ? `collections/reviews/records/${hit.id}` : "collections/reviews/records", { method: hit ? "PATCH" : "POST", body });
  },
  // Page through: a flat perPage=500 silently dropped the oldest reviews once an installation outgrew it.
  async all() {
    const out: ReviewRecord[] = [];
    for (let page = 1; page <= 40; page++) {
      const r = await pb(`collections/reviews/records?perPage=500&page=${page}&sort=-at`);
      out.push(...pbItems(r).map((i) => i.data).filter(isReviewRecord));
      if (page >= (Number(isObj(r) && r.totalPages) || 1)) break;
    }
    return out;
  },
  reviews() {
    return this.all();
  },
  getOAuth: async () => {
    const c = await pb("collections/users");
    if (!isObj(c) || !isOAuthConfig(c.oauth2)) throw new Error("Storage: the users collection has no OAuth2 settings");
    return c.oauth2;
  },
  hasForgeIdentities: async (provider) => pbItems(await pb(`collections/_externalAuths/records?perPage=1&filter=${pbFilterEq("provider", String(provider))}`)).length > 0,
  // Sign-in: PocketBase's manual OAuth2 flow. No superuser token involved; these are public user endpoints.
  async authMethods() {
    const res = await fetch(`${PB_URL}/api/collections/users/auth-methods`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`Storage ${res.status}: ${pbError(await res.text())}`);
    const m: unknown = await res.json();
    if (!isAuthMethods(m)) throw new Error("Storage: unexpected auth-methods response");
    return m;
  },
  async authWithOAuth2(body) {
    const res = await fetch(`${PB_URL}/api/collections/users/auth-with-oauth2`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`Sign-in failed: ${pbError(await res.text())}`);
    const r: unknown = await res.json();
    if (!isAuthResult(r)) throw new Error("Sign-in failed: unexpected response");
    return r;
  },
  async authRefresh(token) {
    const res = await fetch(`${PB_URL}/api/collections/users/auth-refresh`, { method: "POST", headers: { authorization: token }, signal: AbortSignal.timeout(10000) });
    const r: unknown = res.ok ? await res.json() : null;
    return isAuthResult(r) ? r : null;
  },
  userFile: (id, file) => fetch(`${PB_URL}/api/files/users/${id}/${file}`, { signal: AbortSignal.timeout(10000) }),
  users: async () => pbItems(await pb("collections/users/records?perPage=200&sort=created")).flatMap((x) => (isUserRecord(x) ? [x] : [])),
  setRole: (id, role) => pb(`collections/users/records/${id}`, { method: "PATCH", body: JSON.stringify({ role }) }),
  // PocketBase provider names (github, oidc, gitea) linked to an account, from its OAuth identities.
  identities: async (id) => pbItems(await pb(`collections/_externalAuths/records?perPage=50&filter=${pbFilterEq("recordRef", String(id))}`)).map((i) => String(i.provider)),
  deleteUser: (id) => pb(`collections/users/records/${encodeURIComponent(id)}`, { method: "DELETE" }),
  setOAuth: async (oauth2) => pb("collections/users", { method: "PATCH", body: JSON.stringify({ oauth2 }) }),
  // As in the file store: the value is this app's own JSON, typed by SettingsMap.
  getSetting: async <K extends string>(key: K) => (pbItems(await pb(`collections/settings/records?perPage=1&filter=${pbFilterEq("key", String(key))}`))[0]?.value ?? null) as SettingValue<K> | null,
  setSetting: (key, value) => withSettingsLock(async () => {
    const hit = pbItems(await pb(`collections/settings/records?perPage=1&filter=${pbFilterEq("key", String(key))}`))[0];
    await pb(hit ? `collections/settings/records/${hit.id}` : "collections/settings/records", { method: hit ? "PATCH" : "POST", body: JSON.stringify({ key, value }) });
  }),
};
// Typed as the full store: the file store lacks the PocketBase-only methods, which callers reach only when PB_URL is set.
export const store: Store = PB_URL ? pbStore : (fileStore as Store);
