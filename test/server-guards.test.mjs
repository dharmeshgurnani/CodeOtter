// Guards that every request passes through: PR URL parsing, repository scope, account roles and the gate, the
// PocketBase filter guard, provider error mapping and the file store. Runs the real blocks from core/server.mjs with
// storage, fetch and the sidecar stubbed, so nothing leaves the machine.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync, renameSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { serverBlocks } from "./helpers/server-blocks.mjs";

test("server guards", async (ctx) => {

const FORGES = { forgejo: { url: "https://code.example.org", label: "Forgejo" }, gitea: { url: "", label: "Gitea" } };
const { OWNER_RE, REPO_RE, parsePrUrl, validPrUrl, cleanRepo, prUrlFor } = new Function("FORGES", `${serverBlocks("repo-id", "pr-url")}; return { OWNER_RE, REPO_RE, parsePrUrl, validPrUrl, cleanRepo, prUrlFor };`)(FORGES);

// Owner and repository ids are what reaches gh argv and the forge API path.
for (const ok of ["acme", "acme-corp", "a.b_c", "forgejo~acme"]) assert.ok(OWNER_RE.test(ok), ok);
for (const bad of ["", "-acme", "acme/x", "acme;rm", "acme x", "http://acme", "forgejo~"]) assert.ok(!OWNER_RE.test(bad), bad);
for (const ok of ["acme/shop", "gitea~acme/shop", "a.b/c-d_e"]) assert.ok(REPO_RE.test(ok), ok);
for (const bad of ["acme", "acme/", "/shop", "acme/shop/extra", "acme/sh op", "acme/shop;ls", "https://github.com/acme/shop"]) assert.ok(!REPO_RE.test(bad), bad);
ctx.diagnostic("owner and repository ids reject anything that is not a plain path segment");

assert.deepEqual(parsePrUrl("https://github.com/acme/shop/pull/7"), { repo: "acme/shop", number: 7, selfHosted: false });
assert.deepEqual(parsePrUrl("https://code.example.org/acme/shop/pulls/12"), { repo: "forgejo~acme/shop", number: 12, selfHosted: true });
for (const bad of [
  "https://github.com/acme/shop/pull/0",
  "https://github.com/acme/shop/pull/7?x=1",
  "https://github.com/acme/shop/pull/7#top",
  "https://user:pw@github.com/acme/shop/pull/7",
  "https://github.com/acme/shop/pulls/7",
  "https://code.example.org/acme/shop/pull/7",
  "https://evil.example.com/acme/shop/pull/7",
  "http://github.com/acme/shop/pull/7",
  "https://github.com/acme/shop/pull/7/files",
  'https://github.com/acme/shop/pull/7"||url!="',
  "not a url",
  "",
  null,
]) assert.equal(parsePrUrl(bad), null, String(bad));
assert.equal(validPrUrl("https://github.com/acme/shop/pull/7"), true);
assert.equal(validPrUrl("x"), false);
assert.equal(prUrlFor("forgejo~acme/shop", 3), "https://code.example.org/acme/shop/pulls/3");
assert.equal(prUrlFor("acme/shop", 3), "https://github.com/acme/shop/pull/3");
ctx.diagnostic("only canonical GitHub and configured forge PR URLs parse; query, hash, credentials and unknown hosts do not");

assert.equal(cleanRepo("https://github.com/acme/shop/"), "acme/shop");
assert.equal(cleanRepo("https://code.example.org/acme/shop"), "forgejo~acme/shop");
assert.equal(cleanRepo("acme/shop", "forgejo~acme"), "forgejo~acme/shop");
assert.equal(cleanRepo(" acme/shop "), "acme/shop");
ctx.diagnostic("repository input is normalised to its provider-prefixed id");

// Scope: every page is scoped to the active organization; a repository outside it is refused server-side.
const { requestOrg, checkRepoScope } = new Function("OWNER_RE", "REPO_RE", "isForgeRepo", "forgeUrl", `${serverBlocks("scope")}; return { requestOrg, checkRepoScope };`)(
  OWNER_RE, REPO_RE, (r) => /^(forgejo|gitea)~/.test(r), (r) => (r.startsWith("forgejo~") ? FORGES.forgejo.url : r.startsWith("gitea~") ? FORGES.gitea.url : "https://github.com"),
);
assert.equal(requestOrg(new URL("http://x/api/home?org=acme")), "acme");
assert.equal(requestOrg(new URL("http://x/api/home")), "");
assert.throws(() => requestOrg(new URL("http://x/api/home?org=acme/shop")), /Bad organization/);
assert.doesNotThrow(() => checkRepoScope("acme/shop", "acme"));
assert.doesNotThrow(() => checkRepoScope("acme/shop", ""));
assert.throws(() => checkRepoScope("other/shop", "acme"), /outside the active organization/);
assert.throws(() => checkRepoScope("acme-evil/shop", "acme"), /outside the active organization/);
assert.throws(() => checkRepoScope("gitea~acme/shop", "gitea~acme"), /Invalid repository/, "provider without an origin");
assert.throws(() => checkRepoScope("acme", "acme"), /Invalid repository/);
ctx.diagnostic("repositories outside the active organization or on an unconfigured provider are refused");

// PocketBase filters are strings: a quote in the value must not reach them.
const { pbFilterEq } = new Function(`${serverBlocks("pb-filter")}; return { pbFilterEq };`)();
assert.equal(pbFilterEq("url", "https://github.com/acme/shop/pull/7"), encodeURIComponent('url="https://github.com/acme/shop/pull/7"'));
assert.throws(() => pbFilterEq("url", 'x"||url!="'), /Invalid url/);
assert.throws(() => pbFilterEq("key", "a\\b"), /Invalid key/);
ctx.diagnostic("filter values with quotes or backslashes are rejected before PocketBase sees them");

// Roles and the gate, with PocketBase answering through stubs. A response records what the gate wrote.
const loadRoles = ({ pbUrl, users = [], refresh = null, recovery = false }) => {
  const calls = { setRole: [] };
  const store = {
    authRefresh: async () => refresh,
    users: async () => users,
    setRole: async (id, role) => { calls.setRole.push([id, role]); },
  };
  const prev = process.env.PR_SCORER_RECOVERY;
  if (recovery) process.env.PR_SCORER_RECOVERY = "1"; else delete process.env.PR_SCORER_RECOVERY;
  try {
    const cookies = (req) => Object.fromEntries((req.headers.cookie || "").split(";").map((c) => c.trim().split("=")).filter(([k]) => k));
    const out = new Function("PB_URL", "store", "cookies", `${serverBlocks("roles")}; return { gate, allowed, effectiveRole, currentUser };`)(pbUrl, store, cookies);
    return { ...out, calls };
  } finally {
    if (prev === undefined) delete process.env.PR_SCORER_RECOVERY; else process.env.PR_SCORER_RECOVERY = prev;
  }
};
const fakeRes = () => { const r = { statusCode: 200, headers: {}, body: "", setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } }; return r; };
const req = (cookie = "") => ({ headers: cookie ? { cookie } : {} });

{
  const { allowed } = loadRoles({ pbUrl: "http://pb" });
  assert.equal(allowed("owner", "owner"), true);
  assert.equal(allowed("admin", "owner"), false);
  assert.equal(allowed("admin", "admin"), true);
  assert.equal(allowed("developer", "admin"), false);
  assert.equal(allowed("", "admin"), false);
  assert.equal(allowed("", "any"), true);
}
ctx.diagnostic("owner may do everything, admin everything but owner pages, nobody else gets settings");

{
  // bootstrap: no account yet, anonymous counts as owner
  const { gate } = loadRoles({ pbUrl: "http://pb", users: [] });
  const res = fakeRes();
  assert.equal((await gate(req(), res, "owner")).ok, true);
  assert.equal(res.statusCode, 200);
}
{
  // once an account exists, anonymous is refused with login:true
  const { gate } = loadRoles({ pbUrl: "http://pb", users: [{ id: "u1", role: "owner" }] });
  const res = fakeRes();
  assert.equal((await gate(req(), res)).ok, false);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(JSON.parse(res.body), { error: "Sign in to continue", login: true });
}
{
  // a signed-in admin is refused owner pages with login:false
  const { gate } = loadRoles({ pbUrl: "http://pb", users: [{ id: "u1", role: "owner" }, { id: "u2", role: "admin" }], refresh: { token: "t2", record: { id: "u2", role: "admin", email: "a@x" } } });
  const res = fakeRes();
  const r = await gate(req("pr_auth=t2"), res, "owner");
  assert.equal(r.ok, false);
  assert.equal(r.user.role, "admin");
  assert.deepEqual(JSON.parse(res.body), { error: "This needs the owner role", login: false });
  assert.equal((await gate(req("pr_auth=t2"), fakeRes(), "admin")).ok, true);
}
{
  // the first account to sign in becomes owner, later ones admin
  const first = loadRoles({ pbUrl: "http://pb", users: [], refresh: { token: "t1", record: { id: "u1", role: "" } } });
  assert.equal((await first.currentUser(req("pr_auth=t1"))).role, "owner");
  assert.deepEqual(first.calls.setRole, [["u1", "owner"]]);
  const second = loadRoles({ pbUrl: "http://pb", users: [{ id: "u1", role: "owner" }], refresh: { token: "t2", record: { id: "u2", role: "" } } });
  assert.equal((await second.currentUser(req("pr_auth=t2"))).role, "admin");
}
{
  // an expired token is anonymous; recovery mode makes anonymous owner again
  const { gate } = loadRoles({ pbUrl: "http://pb", users: [{ id: "u1", role: "owner" }], refresh: null });
  assert.equal((await gate(req("pr_auth=stale"), fakeRes())).ok, false);
  const rec = loadRoles({ pbUrl: "http://pb", users: [{ id: "u1", role: "owner" }], refresh: null, recovery: true });
  assert.equal((await rec.gate(req(), fakeRes(), "owner")).ok, true);
}
{
  // file storage has no accounts: the single operator is owner
  const { gate } = loadRoles({ pbUrl: "" });
  assert.equal((await gate(req("pr_auth=whatever"), fakeRes(), "owner")).ok, true);
}
ctx.diagnostic("gate: bootstrap owner, 403 with login flag once an account exists, first sign-in is owner, recovery mode");

// Provider error mapping: a 200 with no text, an {error} body or a non-JSON body must name the problem, not throw a TypeError.
const loadAsk = (reply) => {
  const fetch = async () => reply;
  const PROVIDERS = { openai: { label: "OpenAI" }, local_x: { noKey: true } };
  return new Function("fetch", "PROVIDERS", "ensureSidecar", "withAbort", `${serverBlocks("ask-model")}; return askModel;`)(fetch, PROVIDERS, async () => 1, () => undefined);
};
const jsonReply = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
const c = { provider: "openai", model: "gpt", apiKey: "k", baseUrl: "https://api.example.com/v1/" };
assert.equal(await loadAsk(jsonReply({ choices: [{ message: { content: "<think>hmm</think>fine" } }] }))("p", c), "fine");
await assert.rejects(loadAsk(jsonReply({ choices: [] }))("p", c), /LLM returned no text/);
await assert.rejects(loadAsk(jsonReply({ error: { message: "model overloaded" } }))("p", c), /LLM returned no text: model overloaded/);
await assert.rejects(loadAsk({ ok: true, status: 200, json: async () => { throw new SyntaxError("bad json"); }, text: async () => "<html>" })("p", c), /LLM returned no text/);
await assert.rejects(loadAsk(jsonReply({ error: "rate limited" }, 429))("p", c), /LLM 429: .*rate limited/);
await assert.rejects(loadAsk(jsonReply({}))("p", { ...c, apiKey: "" }), /No API key for OpenAI/);
await assert.rejects(loadAsk(jsonReply({}))("p", { ...c, model: "" }), /No model configured/);
const anthropic = { provider: "anthropic", api: "anthropic", model: "claude", apiKey: "k", baseUrl: "https://api.anthropic.com" };
assert.equal(await loadAsk(jsonReply({ content: [{ type: "text", text: "ok" }] }))("p", anthropic), "ok");
await assert.rejects(loadAsk(jsonReply({ stop_reason: "refusal" }))("p", anthropic), /declined/);
await assert.rejects(loadAsk(jsonReply({ type: "error", error: { message: "x" } }))("p", anthropic), /Anthropic returned no content/);
ctx.diagnostic("provider answers without text are reported with the provider's message, never as a TypeError");

// File store: atomic writes and unreadable score files are skipped rather than taking the board down.
const home = mkdtempSync(join(tmpdir(), "codeotter-guards-"));
const SCORES = join(home, "scores");
const CONFIG = join(home, "config.json");
const warnings = [];
const origWarn = console.warn;
console.warn = (m) => warnings.push(String(m));
try {
  const { fileStore } = new Function("SCORES", "CONFIG", "existsSync", "readFileSync", "writeFileSync", "renameSync", "readdirSync", "mkdirSync", "join", "createHash", "console", `${serverBlocks("file-store")}; return { fileStore };`)(
    SCORES, CONFIG, existsSync, readFileSync, writeFileSync, renameSync, readdirSync, mkdirSync, join, (await import("node:crypto")).createHash, console,
  );
  await fileStore.init();
  const review = (n, at) => ({ pr: { url: `https://github.com/acme/shop/pull/${n}`, number: n, title: `pr ${n}` }, review: { scores: { quality: 50 }, verdict: "comment" }, blast: { score: 1 }, at });
  await fileStore.put(review(1, "2026-01-01T00:00:00Z"));
  await fileStore.put(review(2, "2026-02-01T00:00:00Z"));
  writeFileSync(join(SCORES, "broken.json"), "{ not json");
  writeFileSync(join(SCORES, "empty.json"), "");
  writeFileSync(join(SCORES, "wrong-shape.json"), JSON.stringify({ hello: "world" }));
  const all = await fileStore.all();
  assert.deepEqual(all.map((r) => r.pr.number), [2, 1], "newest first, bad files skipped");
  assert.equal(warnings.filter((w) => w.includes("skipping unreadable")).length, 2);
  assert.ok(!readdirSync(SCORES).some((f) => f.endsWith(".tmp")), "no temp file left behind");
  assert.deepEqual(await fileStore.get("https://github.com/acme/shop/pull/2"), review(2, "2026-02-01T00:00:00Z"));
  ctx.diagnostic("unreadable or malformed score files are skipped with a warning; writes leave no temp files");

  // concurrent setSetting calls do not lose each other's keys
  await Promise.all([fileStore.setSetting("a", 1), fileStore.setSetting("b", 2), fileStore.setSetting("c", 3)]);
  assert.deepEqual(JSON.parse(readFileSync(CONFIG, "utf8")), { a: 1, b: 2, c: 3 });
  assert.equal(await fileStore.getSetting("b"), 2);
  assert.equal(await fileStore.getSetting("missing"), null);
  ctx.diagnostic("settings written concurrently are serialised; none is lost");
} finally {
  console.warn = origWarn;
  rmSync(home, { recursive: true, force: true });
}

});
