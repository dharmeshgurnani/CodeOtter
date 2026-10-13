// Accounts: the developer role, per-account repositories, invites and refused sign-ins. The first half runs the real
// <roles> and <visibility> blocks with stubs; the second starts core/server.mjs against an in-memory fake PocketBase in a
// temp CODEOTTER_HOME, with gh off PATH and outbound fetch blocked, and checks every developer-reachable endpoint.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { serverBlocks } from "./helpers/server-blocks.mjs";

test("accounts: developer role, repository access, invites", async (ctx) => {

// ---- Roles and visibility, with stubs ----
const load = ({ users = [{ id: "o", role: "owner" }], invites = [], access = {} } = {}) => {
  const settings = { invites, access };
  const calls = { setRole: [] };
  const store = {
    users: async () => users,
    setRole: async (id, role) => { calls.setRole.push([id, role]); const u = users.find((x) => x.id === id); if (u) u.role = role; else users.push({ id, role }); },
    getSetting: async (k) => settings[k] ?? null,
    setSetting: async (k, v) => { settings[k] = v; },
    identities: async () => [],
    authRefresh: async () => null,
  };
  const repos = async () => ["acme/api", "acme/secret", "gitea~acme/ops"];
  const out = new Function("PB_URL", "store", "cookies", "repos", `${serverBlocks("roles", "visibility")}; return { admit, allowed, ROLES, visibleRepos, canSeeRepo, assertRepo };`)("http://pb", store, () => ({}), repos);
  return { ...out, settings, calls };
};

{
  const { allowed, ROLES } = load();
  assert.deepEqual(ROLES, ["owner", "admin", "developer"]);
  assert.equal(allowed("developer", "review"), true);
  assert.equal(allowed("admin", "review"), true);
  assert.equal(allowed("", "review"), false);
  assert.equal(allowed("developer", "admin"), false);
  assert.equal(allowed("developer", "owner"), false);
  assert.equal(allowed("admin", "admin"), true);
  assert.equal(allowed("admin", "owner"), false);
}
ctx.diagnostic("developer passes the review level only; admin and owner levels are unchanged");

{
  // no owner yet: the first account is owner, invite or not
  const t = load({ users: [] });
  assert.equal(await t.admit({ id: "n1", role: "" }, ["github"], "anyone"), "owner");
  assert.deepEqual(t.calls.setRole, [["n1", "owner"]]);
  // an account that already has a role keeps it
  const k = load();
  assert.equal(await k.admit({ id: "a", role: "admin" }, ["github"]), "admin");
  assert.deepEqual(k.calls.setRole, []);
  // later accounts: refused without an invite
  const none = load();
  assert.equal(await none.admit({ id: "n2", role: "" }, ["github"], "stranger"), "");
  assert.deepEqual(none.calls.setRole, []);
}
{
  // two first sign-ins at once: admissions run one at a time, so only one becomes owner
  const t = load({ users: [] });
  const both = await Promise.all([t.admit({ id: "f1", role: "" }, ["github"], "a"), t.admit({ id: "f2", role: "" }, ["github"], "b")]);
  assert.deepEqual(both.sort(), ["", "owner"]);
}
ctx.diagnostic("first sign-in is owner; later sign-ins without an invite get no role; concurrent first sign-ins yield one owner");

{
  const invite = { id: "i1", provider: "github", pb: "github", login: "bob", role: "developer", repos: ["acme/api"] };
  const t = load({ invites: [invite] });
  assert.equal(await t.admit({ id: "n3", role: "" }, ["gitea"], "bob"), "", "same username on another provider");
  assert.equal(await t.admit({ id: "n3", role: "", name: "bob" }, ["github"]), "", "the display name never matches an invite");
  assert.equal(await t.admit({ id: "n3", role: "", name: "Someone" }, ["github"], "BoB"), "developer", "provider username, case-insensitive");
  assert.deepEqual(t.calls.setRole, [["n3", "developer"]]);
  assert.deepEqual(t.settings.access, { n3: ["acme/api"] });
  assert.deepEqual(t.settings.invites, [], "the invite is used up");
  const admin = load({ invites: [{ ...invite, role: "admin", repos: [] }] });
  assert.equal(await admin.admit({ id: "n4", role: "" }, ["github"], "bob"), "admin");
  assert.deepEqual(admin.settings.access, {}, "admins get no repository list");
}
ctx.diagnostic("invites match by provider + username and assign role and repositories once");

{
  const invite = { id: "i2", provider: "github", pb: "github", login: "carol@x.io", role: "developer", repos: ["acme/secret"] };
  const t = load({ invites: [invite] });
  assert.equal(await t.admit({ id: "c1", role: "", email: "carol@x.io", verified: false }, ["github"], "carol-gh"), "", "unverified email");
  assert.equal(await t.admit({ id: "c1", role: "", email: "", verified: true }, ["github"], "carol-gh"), "", "no email");
  assert.equal(await t.admit({ id: "c1", role: "", email: "carol@x.io", verified: true }, ["gitea"], "carol-gh"), "", "email on a non-GitHub identity");
  assert.equal(t.settings.invites.length, 1, "refusals leave the invite in place");
  assert.equal(await t.admit({ id: "c1", role: "", email: "Carol@X.io", verified: true }, ["github"], "carol-gh"), "developer");
  const gitea = load({ invites: [{ ...invite, provider: "gitea", pb: "gitea" }] });
  assert.equal(await gitea.admit({ id: "c2", role: "", email: "carol@x.io", verified: true }, ["gitea"], "carol"), "", "email invites never match outside GitHub");
}
ctx.diagnostic("email invites match only a verified GitHub email; unverified or other-provider email is refused");

{
  const t = load({ access: { d1: ["acme/api", "gone/repo"] } });
  const dev = { user: { id: "d1" }, role: "developer" };
  assert.deepEqual(await t.visibleRepos({ role: "owner" }), ["acme/api", "acme/secret", "gitea~acme/ops"]);
  assert.deepEqual(await t.visibleRepos({ user: { id: "a" }, role: "admin" }), ["acme/api", "acme/secret", "gitea~acme/ops"]);
  assert.deepEqual(await t.visibleRepos(dev), ["acme/api"], "only onboarded, assigned repositories");
  assert.deepEqual(await t.visibleRepos({ user: { id: "d2" }, role: "developer" }), []);
  assert.deepEqual(await t.visibleRepos({ user: null, role: "" }), []);
  assert.equal(await t.canSeeRepo(dev, "acme/secret"), false);
  assert.equal(await t.canSeeRepo({ role: "admin" }, "not/onboarded"), true, "admins are not narrowed");
  await assert.rejects(t.assertRepo(dev, "acme/secret"), (e) => e.status === 403);
  await t.assertRepo(dev, "acme/api");
}
ctx.diagnostic("visibleRepos/canSeeRepo: owners and admins see everything, developers their onboarded assignments");

// ---- The real server against a fake PocketBase ----
const review = (repo, n, quality) => ({ pr: { url: `https://github.com/${repo}/pull/${n}`, number: n, title: `pr ${n}`, changedFiles: 1, additions: 1, deletions: 0 }, review: { verdict: "comment", scores: { quality }, findings: [], summary: "s", walkthrough: [] }, blast: { score: 10 }, at: new Date().toISOString(), model: "m" });
const db = {
  users: [{ id: "u-owner", role: "owner", name: "olive" }, { id: "u-admin", role: "admin", name: "adam" }, { id: "u-dev", role: "developer", name: "devon" }],
  tokens: { towner: "u-owner", tadmin: "u-admin", tdev: "u-dev" },
  settings: { repos: ["acme/api", "acme/secret", "other/tool"], onboardingComplete: true, access: { "u-dev": ["acme/api"] } },
  reviews: [review("acme/api", 1, 80), review("acme/secret", 2, 30)],
  deleted: [],
  oauth: [],
};
const pbFake = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://pb");
  const body = await new Promise((ok) => { let b = ""; req.on("data", (d) => (b += d)).on("end", () => ok(b ? JSON.parse(b) : {})); });
  const send = (o, status = 200) => { res.statusCode = status; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(o)); };
  const f = /^(\w+)="(.*)"$/.exec(u.searchParams.get("filter") || "");
  const p = u.pathname;
  let m;
  if (p === "/api/health") return send({ code: 200 });
  if (p === "/api/collections/_superusers/auth-with-password") return send({ token: "su" });
  if (p === "/api/collections/users/auth-methods") return send({ oauth2: { enabled: true, providers: [{ name: "github", state: "st", codeVerifier: "cv", authURL: "https://github.com/login/oauth/authorize?redirect_uri=" }] } });
  if (p === "/api/collections/users/auth-with-oauth2") { const next = db.oauth.shift(); if (!db.users.some((x) => x.id === next.record.id)) db.users.push(next.record); return send(next); }
  if (p === "/api/collections/users/auth-refresh") { const rec = db.users.find((x) => x.id === db.tokens[req.headers.authorization]); return rec ? send({ token: req.headers.authorization, record: rec }) : send({ message: "invalid" }, 401); }
  if (p === "/api/collections/users/records") return send({ items: db.users, totalPages: 1 });
  if ((m = /^\/api\/collections\/users\/records\/(.+)$/.exec(p))) {
    const id = decodeURIComponent(m[1]);
    if (req.method === "DELETE") { db.deleted.push(id); db.users = db.users.filter((x) => x.id !== id); res.statusCode = 204; return res.end(); }
    const rec = db.users.find((x) => x.id === id);
    if (!rec) return send({ message: "missing" }, 404);
    Object.assign(rec, body);
    return send(rec);
  }
  if (p === "/api/collections/_externalAuths/records") return send({ items: [], totalPages: 1 });
  if (p === "/api/collections/reviews/records") return send({ items: db.reviews.filter((r) => !f || r.pr.url === f[2]).map((r) => ({ id: r.pr.number, data: r })), totalPages: 1 });
  if (p === "/api/collections/settings/records" && req.method === "GET") return send({ items: f && f[2] in db.settings ? [{ id: f[2], key: f[2], value: db.settings[f[2]] }] : [] });
  if (p.startsWith("/api/collections/settings/records")) { db.settings[body.key] = body.value; return send({}); }
  if (p === "/api/collections/users") return send({ oauth2: { enabled: true, providers: [{ name: "github" }] } });
  send({ message: `fake pb: ${req.method} ${p}` }, 404);
});
const listen = (s) => new Promise((ok) => s.listen(0, "127.0.0.1", () => ok(s.address().port)));
const pbPort = await listen(pbFake);
const port = await (async () => { const s = http.createServer(); const n = await listen(s); await new Promise((ok) => s.close(ok)); return n; })();

const home = mkdtempSync(join(tmpdir(), "codeotter-accounts-"));
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(path|pb_.*|gh_.*|github_.*|forgejo_.*|gitea_.*|repo|app_url|pr_scorer.*|codeotter.*|port|typesafe.*|anthropic.*|openai.*|minimax.*)$/i.test(k)));
Object.assign(env, { PATH: dirname(process.execPath), CODEOTTER_HOME: home, PR_SCORER_DATA: join(home, ".local"), PORT: String(port), PB_URL: `http://127.0.0.1:${pbPort}`, REPO: "acme/api", CODEOTTER_UPDATE_CHECK: "0" });
// Nothing leaves the machine: the server may only fetch 127.0.0.1 (the fake PocketBase); gh is not on PATH.
const guard = 'const f=globalThis.fetch;globalThis.fetch=(u,i)=>{const h=new URL(typeof u==="string"||u instanceof URL?u:u.url).hostname;return h==="127.0.0.1"||h==="localhost"?f(u,i):Promise.reject(new Error("network blocked in test: "+h));};';
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const child = spawn(process.execPath, ["--import", `data:text/javascript,${encodeURIComponent(guard)}`, join(root, "core", "server.mjs")], { env, cwd: home, stdio: ["ignore", "pipe", "pipe"] });
let log = "";
child.stderr.on("data", (d) => { log += d; });
try {
  await new Promise((ok, fail) => {
    const t = setTimeout(() => fail(new Error(`server did not start:\n${log}`)), 30000);
    child.stdout.on("data", (d) => { log += d; if (String(d).includes("CodeOtter on http")) { clearTimeout(t); ok(); } });
    child.once("exit", (code) => { clearTimeout(t); fail(new Error(`server exited ${code}:\n${log}`)); });
  });
  const base = `http://127.0.0.1:${port}`;
  const call = async (path, { token, cookie, method = "GET", body } = {}) => {
    const r = await fetch(`${base}${path}`, { method, redirect: "manual", headers: { ...(token || cookie ? { cookie: cookie || `pr_auth=${token}` } : {}), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: r.status, json, headers: r.headers };
  };
  const secret = "https://github.com/acme/secret/pull/2";
  const mine = "https://github.com/acme/api/pull/1";

  // Developer: only assigned repositories, no settings pages.
  const board = await call("/api/reviews?org=", { token: "tdev" });
  assert.equal(board.status, 200);
  assert.deepEqual(board.json.repos, ["acme/api"]);
  assert.deepEqual(board.json.settingsPages, []);
  assert.equal(board.json.onboardingNeeded, false);
  assert.deepEqual(board.json.reviewed.map((r) => r.pr.url), [mine]);
  assert.deepEqual((await call("/api/reviews?org=acme", { token: "tdev" })).json.reviewed.map((r) => r.pr.url), [mine]);
  assert.deepEqual((await call("/api/reviews?org=other", { token: "tdev" })).json.reviewed, []);
  const homePage = (await call("/api/home", { token: "tdev" })).json;
  const homeText = JSON.stringify(homePage);
  assert.ok(homeText.includes("acme/api") && !homeText.includes("acme/secret") && !homeText.includes("other/tool"), homeText);
  assert.ok(!homeText.includes("/settings/"), "no settings links for developers");
  ctx.diagnostic("developer board, home and organization list hold only assigned repositories; no settings pages");

  for (const page of ["repos", "model", "git", "oauth", "models", "accounts"]) assert.equal((await call(`/api/settings/${page}`, { token: "tdev" })).status, 403, page);
  assert.equal((await call("/api/settings/repo?org=acme&repo=acme%2Fapi", { token: "tdev" })).status, 403);
  assert.equal((await call("/api/settings/accounts/uninvite", { token: "tdev", method: "POST", body: { item: "invite:x" } })).status, 403);
  assert.equal((await call("/api/onboarding", { token: "tdev" })).status, 403);
  assert.equal((await call("/api/onboarding/save-repos", { token: "tdev", method: "POST", body: { repos: ["x/y"] } })).status, 403);
  ctx.diagnostic("settings, admin and onboarding endpoints refuse developers");

  assert.equal((await call(`/api/score?pr=${encodeURIComponent(secret)}&async=1`, { token: "tdev" })).status, 403);
  assert.equal((await call(`/api/score?pr=2&repo=acme%2Fsecret&async=1&force=1`, { token: "tdev" })).status, 403, "re-review by number");
  assert.equal((await call(`/score?pr=${encodeURIComponent(secret)}`, { token: "tdev" })).status, 403);
  assert.equal((await call(`/api/triage?pr=${encodeURIComponent(secret)}`, { token: "tdev" })).status, 403);
  assert.equal((await call(`/api/triage?pr=${encodeURIComponent(mine)}`, { token: "tdev" })).status, 200);
  assert.equal((await call("/api/triage", { token: "tdev" })).status, 200);
  assert.equal((await call("/api/tools", { token: "tdev" })).status, 200);
  assert.equal((await call("/api/tools", { token: "tdev", method: "POST", body: { prUrl: secret, tool: "describe" } })).status, 403);
  assert.equal((await call("/api/review-suggestions", { token: "tdev", method: "POST", body: { prUrl: secret } })).status, 403);
  assert.equal((await call("/api/learnings", { token: "tdev", method: "POST", body: { repo: "acme/secret", title: "x" } })).status, 403);
  assert.equal((await call("/api/learnings", { token: "tdev", method: "POST", body: { repo: "acme/api", title: "noise" } })).status, 200);
  assert.equal((await call(`/og.svg?pr=${encodeURIComponent(secret)}`, { token: "tdev" })).status, 403);
  assert.equal((await call(`/og.svg?pr=${encodeURIComponent(mine)}`, { token: "tdev" })).status, 200);
  ctx.diagnostic("reviews, re-reviews, triage, PR tools, suggestions, learnings and og image: 403 outside the developer's repositories");

  // Admins see everything but Manage accounts; anonymous gets nothing once accounts exist.
  assert.deepEqual((await call("/api/reviews?org=", { token: "tadmin" })).json.repos, ["acme/api", "acme/secret", "other/tool"]);
  assert.equal((await call(`/api/triage?pr=${encodeURIComponent(secret)}`, { token: "tadmin" })).status, 200);
  assert.equal((await call("/api/settings/accounts", { token: "tadmin" })).status, 403);
  assert.equal((await call("/api/settings/accounts", { token: "tadmin", method: "POST", body: { invite: { login: "eve", provider: "github", role: "admin" } } })).status, 403);
  assert.deepEqual((await call("/api/reviews")).json, { error: "Sign in to continue", login: true });
  ctx.diagnostic("admins see every repository; Manage accounts stays owner-only; anonymous is refused");

  // Owner: invites, the accounts table and per-account repositories.
  const inv = await call("/api/settings/accounts", { token: "towner", method: "POST", body: { invite: { login: " BoB ", provider: "github", role: "developer", repos: ["acme/secret", "nope/x"] } } });
  assert.equal(inv.status, 200, JSON.stringify(inv.json));
  assert.equal((await call("/api/settings/accounts", { token: "towner", method: "POST", body: { invite: { login: "carol@x.io", provider: "github", role: "admin", repos: ["acme/api"] } } })).status, 200);
  assert.match((await call("/api/settings/accounts", { token: "towner", method: "POST", body: { invite: { login: "dan", provider: "gitea", role: "developer" } } })).json.error, /sign-in enabled/);
  assert.match((await call("/api/settings/accounts", { token: "towner", method: "POST", body: { invite: { login: "dan", provider: "github", role: "owner" } } })).json.error, /Unknown role/);
  assert.match((await call("/api/settings/accounts", { token: "towner", method: "POST", body: { invite: { login: "bad name", provider: "github", role: "developer" } } })).json.error, /username or an email/);
  assert.deepEqual(db.settings.invites.map(({ login, pb, role, repos }) => ({ login, pb, role, repos })), [
    { login: "bob", pb: "github", role: "developer", repos: ["acme/secret"] },
    { login: "carol@x.io", pb: "github", role: "admin", repos: [] },
  ]);
  const accounts = (await call("/api/settings/accounts", { token: "towner" })).json;
  const rows = accounts.values.accounts.rows;
  assert.equal(rows.find((r) => r.id === "u-owner").cells.repos, "All");
  assert.equal(rows.find((r) => r.id === "u-dev").cells.repos, "acme/api");
  assert.deepEqual(rows.find((r) => r.id === "u-dev").settings.values, { role: "developer", repos: ["acme/api"] });
  const pending = rows.filter((r) => r.id.startsWith("invite:"));
  assert.equal(pending.length, 2);
  assert.deepEqual(pending[0].cells.status, { text: "Pending", tone: "warn" });
  assert.deepEqual(pending[0].actions, [{ id: "uninvite", label: "Remove" }]);
  const inviteSection = accounts.sections.find((s) => s.id === "invite");
  assert.deepEqual(inviteSection.fields.find((x) => x.key === "repos").options.map((o) => o.value), ["acme/api", "acme/secret", "other/tool"]);
  assert.deepEqual(inviteSection.fields.find((x) => x.key === "provider").options, [{ value: "github", label: "GitHub" }]);
  ctx.diagnostic("owner invites by username or GitHub email; pending invites show as rows; repositories offered are the onboarded ones");

  const devRow = rows.find((r) => r.id === "u-dev");
  const post = (row) => call("/api/settings/accounts", { token: "towner", method: "POST", body: { accounts: { rows: rows.map((r) => (r.id === row.id ? { ...row, edited: true } : { ...r, edited: false })) } } });
  assert.equal((await post({ ...devRow, settings: { ...devRow.settings, values: { role: "developer", repos: ["acme/api", "acme/secret", "x/none"] } } })).status, 200);
  assert.deepEqual(db.settings.access["u-dev"], ["acme/api", "acme/secret"]);
  assert.deepEqual((await call("/api/reviews?org=", { token: "tdev" })).json.repos, ["acme/api", "acme/secret"]);
  assert.equal((await call(`/api/triage?pr=${encodeURIComponent(secret)}`, { token: "tdev" })).status, 200);
  assert.equal((await post({ ...devRow, settings: { ...devRow.settings, values: { role: "developer", repos: ["acme/api"] } } })).status, 200);
  assert.equal((await call(`/api/triage?pr=${encodeURIComponent(secret)}`, { token: "tdev" })).status, 403, "unassigning takes effect at once");
  ctx.diagnostic("the gear dialog assigns repositories; access follows immediately");

  // Sign-in: uninvited refused and deleted; invited matched by username or verified GitHub email.
  const signIn = async (reply) => {
    db.oauth.push(reply);
    const start = await call("/api/auth/start?provider=github");
    const key = /pr_oauth=([^;]+)/.exec(start.headers.get("set-cookie"))[1];
    const cb = await call("/auth/callback?state=st&code=c", { cookie: `pr_oauth=${key}` });
    return { status: cb.status, location: cb.headers.get("location") || "", cookie: cb.headers.get("set-cookie") || "" };
  };
  const mallory = await signIn({ token: "tmal", record: { id: "u-mal", role: "", name: "mallory", email: "", verified: false }, meta: { username: "mallory" } });
  assert.equal(mallory.location, `/login?login_error=${encodeURIComponent("Not invited: ask an owner for an invite")}`);
  assert.ok(!/pr_auth=tmal/.test(mallory.cookie), "no session for a refused sign-in");
  assert.ok(db.deleted.includes("u-mal") && !db.users.some((x) => x.id === "u-mal"));
  const bob = await signIn({ token: "tbob", record: { id: "u-bob", role: "", name: "BoB", email: "", verified: false }, meta: { username: "BoB" } });
  assert.equal(bob.location, "/");
  assert.equal(db.users.find((x) => x.id === "u-bob").role, "developer");
  assert.deepEqual(db.settings.access["u-bob"], ["acme/secret"]);
  db.tokens.tbob = "u-bob";
  assert.deepEqual((await call("/api/reviews?org=", { token: "tbob" })).json.repos, ["acme/secret"]);
  assert.equal((await call("/api/me", { token: "tbob" })).json.user.role, "developer");
  const carolUnverified = await signIn({ token: "tc1", record: { id: "u-c1", role: "", name: "carol-gh", email: "carol@x.io", verified: false }, meta: { username: "carol-gh" } });
  assert.match(carolUnverified.location, /login_error=Not%20invited/);
  assert.ok(db.deleted.includes("u-c1"));
  const carol = await signIn({ token: "tc2", record: { id: "u-c2", role: "", name: "carol-gh", email: "carol@x.io", verified: true }, meta: { username: "carol-gh" } });
  assert.equal(carol.location, "/");
  assert.equal(db.users.find((x) => x.id === "u-c2").role, "admin");
  assert.deepEqual(db.settings.invites, [], "both invites used up");
  const olive = await signIn({ token: "towner", record: db.users.find((x) => x.id === "u-owner"), meta: { username: "olive" } });
  assert.equal(olive.location, "/", "existing accounts keep signing in with their role");
  ctx.diagnostic("uninvited sign-in is refused and its account deleted; invites match by username or verified GitHub email only");

  // Pending invite removal.
  await call("/api/settings/accounts", { token: "towner", method: "POST", body: { invite: { login: "zed", provider: "github", role: "developer" } } });
  const zed = db.settings.invites[0].id;
  assert.equal((await call("/api/settings/accounts/uninvite", { token: "towner", method: "POST", body: { item: `invite:${zed}` } })).json.message, "Invite removed.");
  assert.deepEqual(db.settings.invites, []);
  ctx.diagnostic("a pending invite is removed from its row");

  // An account without a role (refused, or never admitted) has no session anywhere: only /auth/callback admits.
  db.users.push({ id: "u-norole", role: "", name: "bob", email: "", verified: false });
  db.tokens.tnorole = "u-norole";
  assert.equal((await call("/api/me", { token: "tnorole" })).json.user, null);
  assert.equal((await call("/api/reviews?org=", { token: "tnorole" })).status, 403);
  assert.equal(db.users.find((x) => x.id === "u-norole").role, "", "not admitted by a plain request");
  ctx.diagnostic("a role-less account is never admitted outside the sign-in callback");

  // Repository settings: a save changes only what it sends; lists apply removals only.
  const repoUrl = "/api/settings/repo?org=acme&repo=acme%2Fapi";
  const before = (await call(repoUrl, { token: "towner" })).json.values.repo;
  assert.ok(before.learnings.length >= 1, JSON.stringify(before));
  assert.equal((await call(repoUrl, { token: "towner", method: "POST", body: { repo: { postScores: true } } })).status, 200);
  const partial = (await call(repoUrl, { token: "towner" })).json.values.repo;
  assert.deepEqual(partial.learnings, before.learnings, "a partial save keeps learnings");
  assert.equal(partial.postScores, true);
  assert.equal(partial.maxFindings, before.maxFindings, "other review values are merged, not reset");
  // stale page: a learning added after the page loaded survives that page's Save
  assert.equal((await call("/api/learnings", { token: "towner", method: "POST", body: { repo: "acme/api", title: "added meanwhile" } })).status, 200);
  assert.equal((await call(repoUrl, { token: "towner", method: "POST", body: { repo: partial } })).status, 200);
  const after = (await call(repoUrl, { token: "towner" })).json.values.repo;
  assert.ok(after.learnings.some((l) => l.includes("added meanwhile")), JSON.stringify(after.learnings));
  // removing one in the page drops just that one
  const drop = after.learnings[0];
  assert.equal((await call(repoUrl, { token: "towner", method: "POST", body: { repo: { ...after, learnings: after.learnings.slice(1) } } })).status, 200);
  assert.ok(!(await call(repoUrl, { token: "towner" })).json.values.repo.learnings.includes(drop));
  ctx.diagnostic("Repository settings saves are partial and keep learnings added while the page was open");
} finally {
  if (child.exitCode === null) await new Promise((ok) => { child.once("exit", ok); child.kill(); });
  await new Promise((ok) => pbFake.close(ok));
  rmSync(home, { recursive: true, force: true });
}
});
