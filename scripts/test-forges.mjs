// End-to-end integration tests. Only disposable Forgejo/PocketBase data is written.
// Requires Docker, a built web/, and .pb/pocketbase[.exe] (or TEST_PB_BIN).
// --serve keeps the fixture running for browser QA after assertions pass.
import assert from "node:assert/strict";
import http from "node:http";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const provider = process.argv.includes("--gitea") ? "gitea" : "forgejo";
const envPrefix = provider.toUpperCase();
const image = provider === "gitea" ? "gitea/gitea:1.24.6" : "codeberg.org/forgejo/forgejo:15";
const root = resolve(import.meta.dirname, "..");
const dir = mkdtempSync(join(tmpdir(), `codeotter-${provider}-test-`));
const container = `codeotter-${provider}-test-${randomBytes(4).toString("hex")}`;
const processes = [];
const password = "CodeOtter-Test-Only-2026!";
const pbPassword = randomBytes(24).toString("hex");
let dockerStarted = false;
const extraContainers = [];
let modelServer;
let appCookie = "";
const prompts = [];
let redirectedTokenRequests = 0;
const log = (s) => console.log(`PASS [${provider}] ${s.replaceAll("Forgejo", provider === "gitea" ? "Gitea" : "Forgejo")}`);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function port() {
  const s = http.createServer(); s.listen(0, "127.0.0.1"); await once(s, "listening");
  const p = s.address().port; await new Promise((r) => s.close(r)); return p;
}
async function ready(url) {
  for (let i = 0; i < 120; i++) {
    for (const p of processes) if (p.exitCode !== null) throw new Error(p.testOutput());
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return; } catch {}
    await delay(500);
  }
  throw new Error(`Timed out: ${url}`);
}
function child(bin, args, opts = {}) {
  const p = spawn(bin, args, { windowsHide: true, ...opts, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  p.stdout.on("data", (d) => { output += d; }); p.stderr.on("data", (d) => { output += d; });
  p.on("error", (e) => { output += e.message; });
  processes.push(p); p.testOutput = () => output;
  return p;
}
async function json(url, { method = "GET", body, headers = {} } = {}) {
  const r = await fetch(url, { method, headers: { "content-type": "application/json", ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${new URL(url).pathname}: ${r.status} ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}
async function cleanup() {
  for (const p of processes.reverse()) { if (p.exitCode === null) { p.kill(); await once(p, "exit").catch(() => {}); } }
  if (modelServer) await new Promise((r) => modelServer.close(r));
  for (const name of extraContainers) execFileSync("docker", ["rm", "-f", name], { stdio: "ignore", windowsHide: true });
  if (dockerStarted) execFileSync("docker", ["rm", "-f", container], { stdio: "ignore", windowsHide: true });
  // dir is an absolute directory created by mkdtemp for this run only.
  if (!dir.startsWith(join(tmpdir(), `codeotter-${provider}-test-`))) throw new Error("Unsafe cleanup path");
  rmSync(dir, { recursive: true, force: true });
}

try {
  const [fp, pp, ap, mp] = await Promise.all([port(), port(), port(), port()]);
  const forge = `http://127.0.0.1:${fp}`, pb = `http://127.0.0.1:${pp}`, app = `http://127.0.0.1:${ap}`;
  const pbBin = process.env.TEST_PB_BIN || join(root, ".pb", process.platform === "win32" ? "pocketbase.exe" : "pocketbase");
  assert(existsSync(pbBin), "PocketBase binary required");
  assert(existsSync(join(root, "web", "dist", "index.html")), "Build web first");
  execFileSync("docker", ["run", "--detach", "--rm", "--name", container, "-p", `127.0.0.1:${fp}:3000`,
    "-e", `${envPrefix}__security__INSTALL_LOCK=true`, "-e", `${envPrefix}__database__DB_TYPE=sqlite3`,
    "-e", `${envPrefix}__server__ROOT_URL=${forge}/`, "-e", `${envPrefix}__service__DISABLE_REGISTRATION=true`,
    "-e", `${envPrefix}__api__MAX_RESPONSE_ITEMS=2`, // force pagination, even when client requests 50
    image], { stdio: "pipe", windowsHide: true });
  dockerStarted = true;
  await ready(`${forge}/api/v1/version`);
  execFileSync("docker", ["exec", "--user", "git", container, provider, "--config", "/data/gitea/conf/app.ini", "admin", "user", "create", "--username", "reviewer", "--password", password, "--email", "reviewer@example.test", "--admin", "--must-change-password=false"], { stdio: "pipe", windowsHide: true });
  const basic = `Basic ${Buffer.from(`reviewer:${password}`).toString("base64")}`;
  const fj = (path, options = {}) => json(`${forge}/api/v1/${path}`, { ...options, headers: { authorization: basic } });
  const token = await fj("users/reviewer/tokens", { method: "POST", body: { name: "codeotter-test", scopes: ["read:user", "write:repository", "write:issue"] } });
  await fj("user/repos", { method: "POST", body: { name: "sample", auto_init: true, default_branch: "main", private: true } });
  await fj("user/repos", { method: "POST", body: { name: "second", auto_init: true } });
  await fj("user/repos", { method: "POST", body: { name: "third", auto_init: true } });
  const file = (path, content, more = {}) => fj(`repos/reviewer/sample/contents/${path}`, { method: "POST", body: { content: Buffer.from(content).toString("base64"), ...more } });
  await file("AGENTS.md", "Require tests for arithmetic changes.\n");
  await file("CLAUDE.md", "Preserve return types.\n");
  const issue = await fj("repos/reviewer/sample/issues", { method: "POST", body: { title: "Addition must add", body: "add(2,3) must return 5, with tests." } });
  await file("math.js", "export function add(a, b) {\n  return a - b;\n}\n", { new_branch: "fix-arithmetic", branch: "main" });
  await file("extra.js", "export const extra = true;\n", { branch: "fix-arithmetic" });
  await file("third.js", "export const third = true;\n", { branch: "fix-arithmetic" });
  const pr = await fj("repos/reviewer/sample/pulls", { method: "POST", body: { title: "Add arithmetic", body: `Closes #${issue.number}`, head: "fix-arithmetic", base: "main" } });
  const prUrl = `${forge}/reviewer/sample/pulls/${pr.number}`;
  const oauth = await fj("user/applications/oauth2", { method: "POST", body: { name: "CodeOtter test", redirect_uris: [`${app}/auth/callback`], confidential_client: true } });
  log("disposable Forgejo seeded with private repository, guides, linked issue and multi-page PR");

  modelServer = http.createServer(async (req, res) => {
    const u = new URL(req.url, `http://127.0.0.1:${mp}`);
    if (u.pathname === "/api/v1/user/repos") { res.writeHead(302, { location: `http://127.0.0.1:${mp}/token-leak` }); res.end(); return; }
    if (u.pathname === "/token-leak") redirectedTokenRequests++;
    if (u.pathname === "/github/authorize") {
      const back = new URL(u.searchParams.get("redirect_uri")); back.searchParams.set("state", u.searchParams.get("state")); back.searchParams.set("code", "github-fixture-code");
      res.writeHead(302, { location: back.href }); res.end(); return;
    }
    if (u.pathname.startsWith("/github/")) {
      if (u.pathname === "/github/token") {
        let raw = ""; for await (const part of req) raw += part;
        const form = new URLSearchParams(raw);
        const expected = `Basic ${Buffer.from("github-test-client:github-test-secret").toString("base64")}`;
        if (req.headers.authorization !== expected && form.get("client_secret") !== "github-test-secret") { res.writeHead(401); res.end(); return; }
      }
      res.setHeader("content-type", "application/json");
      const result = u.pathname === "/github/token" ? { access_token: "github-fixture-token", token_type: "bearer" }
        : u.pathname.endsWith("/emails") ? [{ email: "github-reviewer@example.test", verified: true, primary: true }]
        : { id: 12345, login: "github-reviewer", name: "GitHub Reviewer", avatar_url: "" };
      res.end(JSON.stringify(result)); return;
    }
    if (req.method === "GET") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ data: [{ id: "fixture" }] })); return; }
    let body = ""; for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    res.setHeader("content-type", "application/json");
    if (u.pathname === "/v1/systemone") {
      res.end(JSON.stringify({ answers: Object.fromEntries(Object.entries(input.questions).map(([key, q]) => [key, q.type === "score" ? { score: 3 } : { noul: 0.9 }])) })); return;
    }
    const asked = input.messages?.[0]?.content || "";
    prompts.push(asked);
    // The self-check pass scores the review's findings; everything else gets the review.
    if (asked.startsWith("You are checking another reviewer's findings")) {
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ scores: [{ index: 0, score: 9, why: "subtraction instead of addition" }] }) } }] })); return;
    }
    if (asked.startsWith("Write the description of this pull request")) {
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ title: "Add arithmetic helpers", type: ["Feature"], summary: ["Adds add()."], files: [{ file: "math.js", change: "Adds add()." }] }) } }] })); return;
    }
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summary: "Arithmetic uses subtraction.", verdict: "request_changes", scores: { quality: 60, correctness_risk: 80, test_coverage: 20, readability: 80, pr_hygiene: 80, blast_radius: 40 }, walkthrough: [{ file: "math.js", change: "Adds arithmetic." }], findings: [{ file: "math.js", line: 2, severity: "high", title: "Addition subtracts", detail: "Use addition to satisfy the linked issue.", suggestion: "  return a + b;" }] }) } }] }));
  });
  modelServer.listen(mp, "127.0.0.1"); await once(modelServer, "listening");

  const pbDir = join(dir, "pb_data");
  const migrations = join(root, "core", "pb_migrations");
  execFileSync(pbBin, ["superuser", "upsert", "admin@example.test", pbPassword, `--dir=${pbDir}`, `--migrationsDir=${migrations}`], { stdio: "pipe", windowsHide: true });
  child(pbBin, ["serve", `--http=127.0.0.1:${pp}`, `--dir=${pbDir}`, `--migrationsDir=${migrations}`]);
  await ready(`${pb}/api/health`);
  mkdirSync(join(dir, "core"), { recursive: true }); cpSync(join(root, "package.json"), join(dir, "package.json"));
  for (const f of ["server.mjs", "models.json", "showcase.json"]) cpSync(join(root, "core", f), join(dir, "core", f));
  cpSync(join(root, "web", "dist"), join(dir, "web", "dist"), { recursive: true });
  // Never invoke the real GitHub CLI or inspect a real checkout during this suite.
  const preload = join(dir, "github-fixture.mjs");
  const githubPr = { number: 7, url: "https://github.com/reviewer/sample/pull/7", title: "GitHub fixture PR", body: "Independent GitHub review", author: { login: "github-reviewer" }, baseRefName: "main", headRefName: "fix", headRefOid: "a".repeat(40), additions: 3, deletions: 0, changedFiles: 1, files: [{ path: "math.js", additions: 3, deletions: 0 }], commits: [], state: "OPEN" };
  writeFileSync(preload, `import cp from 'node:child_process'; import {syncBuiltinESMExports} from 'node:module';
const pr=${JSON.stringify(githubPr)};
function fixture(args){
 if(args[0]==='repo'&&args[1]==='view')return '{"nameWithOwner":"reviewer/sample"}';
 if(args[0]==='repo'&&args[1]==='list')return '[{"nameWithOwner":"reviewer/sample"}]';
 if(args[0]==='pr'&&args[1]==='list')return JSON.stringify([pr]);
 if(args[0]==='pr'&&args[1]==='view')return JSON.stringify(pr);
 if(args[0]==='pr'&&args[1]==='diff')return 'diff --git a/math.js b/math.js\\n--- /dev/null\\n+++ b/math.js\\n@@ -0,0 +1,3 @@\\n+export function add(a, b) {\\n+  return a - b;\\n+}';
 if(args[0]==='api'&&args[1].startsWith('search/'))return '{"items":[]}';
 if(args[0]==='api'&&args[1].includes('/commits?'))return '[]';
 throw new Error('GitHub fixture: absent');
}
const real=cp.execFileSync; cp.execFileSync=(bin,args,...rest)=>{if(bin==='gh')return fixture(args); if(bin==='git')throw new Error('No checkout'); return real(bin,args,...rest);};
const spawn=cp.spawn; cp.spawn=(bin,args,opts)=>bin==='gh'?spawn(process.execPath,['-e','process.stdout.write(process.argv[1])',fixture(args)],opts):spawn(bin,args,opts);syncBuiltinESMExports();`);
  const backend = child(process.execPath, ["--import", pathToFileURL(preload).href, join(dir, "core", "server.mjs")], { cwd: dir, env: {
    ...process.env, PORT: String(ap), APP_URL: app, PB_URL: pb, PB_ADMIN_EMAIL: "admin@example.test", PB_ADMIN_PASSWORD: pbPassword,
    FORGEJO_URL: "", FORGEJO_TOKEN: "", GITEA_URL: "", GITEA_TOKEN: "", REPO: "reviewer/sample", PR_SCORER_RECOVERY: "", PR_SCORER_DATA: join(dir, "local"),
  } });
  await ready(`${app}/api/me`);
  const api = (path, body) => json(`${app}${path}`, { ...(body !== undefined ? { method: "POST", body } : {}), headers: appCookie ? { cookie: appCookie } : {} });
  await api(`/api/settings/oauth`, { [provider]: { url: `http://127.0.0.1:${mp}`, token: "redirect-test-token" } });
  await assert.rejects(api(`/api/settings/oauth/test${provider}`, {})); assert.equal(redirectedTokenRequests, 0);
  await api(`/api/settings/oauth`, { [provider]: { url: forge, token: token.sha1 } });
  assert.match((await api(`/api/settings/oauth/test${provider}`, {})).message, /Connected/);
  const connection = await api(`/api/settings/oauth`);
  assert.equal(connection.values[provider].token, "");
  assert(!JSON.stringify(connection).includes(token.sha1));
  await api(`/api/settings/oauth`, { [provider]: { url: forge, token: "" } });
  await api(`/api/settings/oauth/test${provider}`, {});
  log("Forgejo connection save, masked token, blank-token preservation and redirect rejection");

  await api("/api/settings/oauth", { oauth: { enabled: true, clientId: "github-test-client", clientSecret: "github-test-secret" } });
  await api("/api/settings/oauth", { [`${provider}oauth`]: { enabled: true, clientId: oauth.client_id, clientSecret: oauth.client_secret } });
  await api("/api/settings/oauth", { [`${provider}oauth`]: { enabled: true, clientId: oauth.client_id, clientSecret: "" } });
  const login = await api("/api/login");
  assert.deepEqual(login.providers.map((p) => p.id), ["github", provider]);
  const settings = await api("/api/settings/oauth");
  assert.equal(settings.values.oauth.clientId, "github-test-client");
  assert(!JSON.stringify(settings).includes(oauth.client_secret));
  const pages = (await api("/api/reviews")).settingsPages.map((p) => p.id);
  assert(pages.includes("oauth"));
  assert(!pages.includes("forgejo") && !pages.includes("gitea"));
  assert(settings.sections.some((s) => s.id === provider));
  assert(settings.sections.some((s) => s.id === `${provider}oauth`));
  log("One OAuth sidebar page contains connections and sign-in; provider saves preserve other secrets");

  const scope = `${provider}~reviewer`;
  await api("/api/settings/repos?org=reviewer", { repos: { list: ["reviewer/sample"], add: `${forge}/reviewer/sample` } });
  const repositorySettings = await api(`/api/settings/repos?org=${scope}`);
  const item = repositorySettings.values.repos.list[0];
  assert.equal(item.id, `${provider}~reviewer/sample`);
  assert.match(item.meta, /AGENTS.md/); assert.match(item.meta, /CLAUDE.md/);
  assert.equal(repositorySettings.sections[0].fields.find((f) => f.key === "add").options.length, 2);
  item.settings.values.postScores = true; item.settings.values.postReview = true;
  await api(`/api/settings/repos?org=${scope}`, { repos: { list: [item], add: "" } });
  const ghBoard = await api("/api/reviews?org=reviewer");
  assert.equal(ghBoard.open.length, 1); assert.equal(ghBoard.open[0].url, githubPr.url);
  const fjBoard = await api(`/api/reviews?org=${scope}`);
  assert.equal(fjBoard.open[0].url, prUrl);
  assert.deepEqual(fjBoard.repos, ["reviewer/sample", `${provider}~reviewer/sample`]);
  log("same-named GitHub/Forgejo repositories stay distinct; discovery paginates; guides detected");

  const adminAuth = await json(`${pb}/api/collections/_superusers/auth-with-password`, { method: "POST", body: { identity: "admin@example.test", password: pbPassword } });
  // Configure a deterministic local model directly in the isolated store.
  await json(`${pb}/api/collections/settings/records`, { method: "POST", headers: { authorization: adminAuth.token }, body: { key: "llm", value: { provider: "custom", model: "fixture", baseUrl: `http://127.0.0.1:${mp}/v1`, apiKey: "fixture" } } });
  const review = await api(`/api/score?pr=${encodeURIComponent(prUrl)}&org=${scope}`);
  assert.equal(review.pr.files.length, 3); assert.equal(review.pr.commits.length, 3);
  assert.equal(review.linkedIssues[0].number, issue.number);
  assert.equal(review.review.scores.quality, 60);
  assert.equal(review.commentsPosted.length, 2);
  assert.equal(review.outsideDiffImpact.callers.length, 0);
  assert(prompts.some((p) => p.includes("Require tests for arithmetic") && p.includes("Preserve return types") && p.includes("add(2,3)")));
  const suggestion = await api(`/api/review-suggestions?org=${scope}`, { prUrl, findingIdx: 0 });
  assert.equal(suggestion.mode, "inline_review");
  const reviews = await fj(`repos/reviewer/sample/pulls/${pr.number}/reviews`);
  assert(reviews.some((r) => r.body === "CodeOtter inline suggestions"));
  await api(`/api/score?pr=${encodeURIComponent(prUrl)}&org=${scope}&force=1`);
  const comments = await fj(`repos/reviewer/sample/issues/${pr.number}/comments?limit=50`);
  assert.equal(comments.filter((c) => c.body.includes("<!-- codeotter:scores -->")).length, 1);
  assert.equal(comments.filter((c) => c.body.includes("<!-- codeotter:review -->")).length, 1);
  log("real PR review, paginated files/commits, linked issue, both guides, inline suggestion and comment upsert");

  await api(`/api/settings/oauth`, { [provider]: { url: forge, token: "invalid-test-token" } });
  await assert.rejects(api(`/api/reviews?org=${scope}`), /401/);
  await api(`/api/settings/oauth`, { [provider]: { url: forge, token: token.sha1 } });
  const before = review.headSha;
  await file("fourth.js", "export const fourth = true;\n", { branch: "fix-arithmetic" });
  // Forgejo updates pull-request commit metadata asynchronously after a push.
  for (let attempt = 0; attempt < 40; attempt++) {
    const latest = await fj(`repos/reviewer/sample/pulls/${pr.number}`);
    const commits = await fj(`repos/reviewer/sample/pulls/${pr.number}/commits`);
    if (latest.head.sha !== before && commits.some((c) => c.sha === latest.head.sha)) break;
    assert(attempt < 39, "Forgejo did not refresh the pull request after push");
    await delay(250);
  }
  const incremental = await api(`/api/score?pr=${encodeURIComponent(prUrl)}&org=${scope}&force=1`);
  assert.notEqual(incremental.headSha, before);
  assert.equal(incremental.incremental.prevSha, before.slice(0, 7));
  assert.equal(incremental.incremental.newCommits.length, 1, JSON.stringify({ before, head: incremental.headSha, commits: incremental.pr.commits, delta: incremental.incremental }));
  assert.equal(incremental.pr.files.length, 4);
  log("invalid credentials fail visibly; re-review refreshes head SHA, files and new commits");

  // Self-check ran on the review's finding and kept it with the model's score.
  assert(prompts.some((p) => p.startsWith("You are checking another reviewer's findings") && p.includes("Addition subtracts")));
  assert.equal(incremental.review.findings[0].confidence, 0.9);
  // Applying CodeOtter's suggestion and re-reviewing records it as an accepted fix for the repository.
  const mathFile = await fj("repos/reviewer/sample/contents/math.js?ref=fix-arithmetic");
  const beforeFix = (await fj(`repos/reviewer/sample/pulls/${pr.number}`)).head.sha;
  await fj("repos/reviewer/sample/contents/math.js", { method: "PUT", body: { content: Buffer.from("export function add(a, b) {\n  return a + b;\n}\n").toString("base64"), sha: mathFile.sha, branch: "fix-arithmetic" } });
  for (let attempt = 0; attempt < 40; attempt++) {
    const latest = await fj(`repos/reviewer/sample/pulls/${pr.number}`);
    const commits = await fj(`repos/reviewer/sample/pulls/${pr.number}/commits`);
    if (latest.head.sha !== beforeFix && commits.some((c) => c.sha === latest.head.sha)) break;
    assert(attempt < 39, "Forgejo did not refresh the pull request after push");
    await delay(250);
  }
  const fixed = await api(`/api/score?pr=${encodeURIComponent(prUrl)}&org=${scope}&force=1`);
  assert.deepEqual(fixed.acceptedFixes, ["[math.js] Addition subtracts"]);
  const repoAfterFix = (await api(`/api/settings/repos?org=${scope}`)).values.repos.list.find((x) => x.id === `${provider}~reviewer/sample`);
  assert.deepEqual(repoAfterFix.settings.values.accepted, ["[math.js] Addition subtracts"]);
  assert(prompts.at(-2).includes("Fixes this team accepted from earlier reviews") || prompts.at(-1).includes("Fixes this team accepted from earlier reviews"));
  log("self-check scores findings; an applied suggestion becomes an accepted fix used by later reviews");

  // Tools: Describe runs, posts an upserted comment, and writes its block into the PR body keeping the author's text.
  const toolList = await api(`/api/tools?org=${scope}`);
  assert.deepEqual(toolList.map((t) => t.id), ["describe", "ask", "improve", "docs", "changelog"]);
  assert.equal(toolList.find((t) => t.id === "describe").apply, "Update PR description");
  const described = await api(`/api/tools?org=${scope}`, { prUrl, tool: "describe", action: "run" });
  assert.match(described.markdown, /\*\*Title:\*\* Add arithmetic helpers/);
  await api(`/api/tools?org=${scope}`, { prUrl, tool: "describe", action: "comment" });
  await api(`/api/tools?org=${scope}`, { prUrl, tool: "describe", action: "comment" });
  const toolComments = (await fj(`repos/reviewer/sample/issues/${pr.number}/comments?limit=50`)).filter((c) => c.body.includes("<!-- codeotter:tool:describe -->"));
  assert.equal(toolComments.length, 1, "describe comment is upserted");
  await api(`/api/tools?org=${scope}`, { prUrl, tool: "describe", action: "apply" });
  await api(`/api/tools?org=${scope}`, { prUrl, tool: "describe", action: "apply" });
  const prBody = (await fj(`repos/reviewer/sample/pulls/${pr.number}`)).body;
  assert(prBody.startsWith(`Closes #${issue.number}`), prBody);
  assert.equal((prBody.match(/<!-- codeotter:describe -->/g) || []).length, 1, prBody);
  await assert.rejects(api(`/api/tools?org=reviewer`, { prUrl, tool: "describe", action: "run" }), /outside the active organization/);
  log("tools: describe runs, comment upserts, PR description block replaces itself, org scope enforced");

  // PR comment commands: a collaborator's /describe gets an eyes reaction, re-runs Describe and upserts its comment; a failing
  // /ask (the fixture never answers questions) is replied to on the PR.
  await json(`${pb}/api/collections/settings/records`, { method: "POST", headers: { authorization: adminAuth.token }, body: { key: "review", value: { commands: true } } });
  const describePrompts = () => prompts.filter((p) => p.startsWith("Write the description of this pull request")).length;
  const describedBefore = describePrompts();
  const cmd = await fj(`repos/reviewer/sample/issues/${pr.number}/comments`, { method: "POST", body: { body: "/describe" } });
  await fj(`repos/reviewer/sample/issues/${pr.number}/comments`, { method: "POST", body: { body: "/ask what does add do?" } });
  let reacted = false, refreshed = false, askFailed = false;
  for (let attempt = 0; attempt < 100 && !(reacted && refreshed && askFailed); attempt++) {
    await delay(1000);
    reacted = (await fj(`repos/reviewer/sample/issues/comments/${cmd.id}/reactions`) || []).some((r) => r.content === "eyes");
    const now = await fj(`repos/reviewer/sample/issues/${pr.number}/comments?limit=50`);
    refreshed = describePrompts() > describedBefore && now.filter((c) => c.body.includes("<!-- codeotter:tool:describe -->")).length === 1;
    askFailed = now.some((c) => c.body.startsWith("🦦 CodeOtter `/ask` failed:"));
  }
  assert(reacted && refreshed && askFailed, JSON.stringify({ reacted, refreshed, askFailed }));
  log("PR comment commands: reaction, tool result refreshed, failures replied to");

  await fj("admin/users", { method: "POST", body: { username: "forker", password, email: "forker@example.test", must_change_password: false } });
  await fj("repos/reviewer/sample/collaborators/forker", { method: "PUT", body: { permission: "read" } });
  const forkApi = (path, options = {}) => json(`${forge}/api/v1/${path}`, { ...options, headers: { authorization: `Basic ${Buffer.from(`forker:${password}`).toString("base64")}` } });
  await forkApi("repos/reviewer/sample/forks", { method: "POST", body: { name: "forked" } });
  const guide = await forkApi("repos/forker/forked/contents/AGENTS.md");
  await forkApi("repos/forker/forked/contents/AGENTS.md", { method: "PUT", body: { sha: guide.sha, content: Buffer.from("FORK_HEAD_GUIDE: require bounds checks.\n").toString("base64"), branch: "main", new_branch: "fork-change" } });
  const forkPr = await fj("repos/reviewer/sample/pulls", { method: "POST", body: { title: "Fork guidelines", body: "Review fork head context", head: "forker:fork-change", base: "main" } });
  const forkUrl = `${forge}/reviewer/sample/pulls/${forkPr.number}`;
  const forkReview = await api(`/api/score?pr=${encodeURIComponent(forkUrl)}&org=${scope}`);
  assert.equal(forkReview.pr.headRepo, `${provider}~forker/forked`);
  assert(prompts.at(-1).includes("FORK_HEAD_GUIDE"));
  log("fork PR guidelines read from the fork at its head SHA");
  const typedSetting = await json(`${pb}/api/collections/settings/records`, { method: "POST", headers: { authorization: adminAuth.token }, body: { key: "s1", value: { provider: "custom", model: "fixture-s1", baseUrl: `http://127.0.0.1:${mp}`, apiKey: "fixture" } } });
  const dual = await api(`/api/score?pr=${encodeURIComponent(prUrl)}&org=${scope}&force=1`);
  assert.equal(dual.review.scores.quality, 75); assert.equal(dual.blast.score, 75);
  assert(dual.engines.llm && dual.engines.s1); assert(dual.gates.some((g) => g.id === "issue_requirements"));
  await json(`${pb}/api/collections/settings/records/${typedSetting.id}`, { method: "PATCH", headers: { authorization: adminAuth.token }, body: { value: { provider: "none" } } });
  log("both review engines run; System One owns scores, blast radius and gates");

  for (const path of [
    `/api/score?pr=${encodeURIComponent(prUrl)}&org=reviewer`,
    `/api/score?pr=${encodeURIComponent(prUrl.replace(forge, "https://unconfigured.invalid"))}`,
  ]) assert(!(await fetch(`${app}${path}`)).ok);
  await assert.rejects(api("/api/learnings?org=reviewer", { prUrl, rule: "Must not save" }));
  await assert.rejects(api(`/api/review-suggestions?org=${scope}`, { prUrl, repo: "reviewer/sample", findingIdx: 0 }));
  assert.equal((await api("/api/reviews?org=reviewer")).reviewed.length, 0);
  assert.equal((await api(`/api/reviews?org=${scope}`)).reviewed.length, 2);
  await assert.rejects(api(`/api/settings/oauth`, { [provider]: { url: "http://127.0.0.1:1", token: "other" } }));
  const cross = await fetch(`${app}/api/settings/oauth`, { headers: { "sec-fetch-site": "cross-site" } }); assert.equal(cross.status, 403);
  const invalid = await fetch(`${app}/api/auth/start?provider=__proto__`); assert(!invalid.ok);
  const start = await fetch(`${app}/api/auth/start?provider=${provider}&back=//evil.invalid`);
  const startData = await start.json(); const authUrl = new URL(startData.url);
  assert.equal(authUrl.origin, forge); assert.equal(authUrl.searchParams.get("code_challenge_method"), "S256");
  const cookie = start.headers.getSetCookie()[0].split(";")[0];
  const bad = await fetch(`${app}/auth/callback?state=wrong&code=bad`, { headers: { cookie }, redirect: "manual" });
  assert.match(bad.headers.get("location"), /login_error/);
  log("cross-forge/org writes, unknown origins, cross-site requests, host reassignment and OAuth state tampering rejected");

  // Browser-equivalent redirects/forms exercise real Forgejo -> real PocketBase OAuth.
  const jars = new Map();
  async function visit(url, options = {}) {
    const origin = new URL(url).origin;
    const jar = jars.get(origin) || new Map(); jars.set(origin, jar);
    const r = await fetch(url, { ...options, redirect: "manual", headers: { ...options.headers, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } });
    for (const c of r.headers.getSetCookie()) {
      const pair = c.split(";")[0], split = pair.indexOf("="); jar.set(pair.slice(0, split), pair.slice(split + 1));
    }
    const text = await r.text();
    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) return visit(new URL(r.headers.get("location"), url).href);
    return { r, text, url };
  }
  async function oauthLogin(loginProvider, origin) {
    const loginFlow = await visit(`${app}/api/auth/start?provider=${loginProvider}`);
    const authorize = JSON.parse(loginFlow.text).url;
    await visit(authorize);
    let consent = await visit(`${origin}/user/login`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin }, body: new URLSearchParams({ user_name: "reviewer", password }) });
    if (!consent.text.includes("authorize-app")) consent = await visit(authorize);
    assert(consent.text.includes("authorize-app"), `Missing OAuth consent form at ${consent.url}`);
    const form = new URLSearchParams(new URL(authorize).search);
    for (const input of consent.text.matchAll(/<input\b[^>]*>/g)) {
      const name = input[0].match(/name="([^"]*)"/)?.[1];
      const value = input[0].match(/value="([^"]*)"/)?.[1];
      if (name && value !== undefined) form.set(name, value.replaceAll("&amp;", "&").replaceAll("&#39;", "'").replaceAll("&#34;", '"'));
    }
    form.set("granted", "true");
    const finish = await visit(`${origin}/login/oauth/grant`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin }, body: form });
    assert.equal(new URL(finish.url).pathname, "/", finish.url);
    return [...jars.get(app)].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  appCookie = await oauthLogin(provider, forge);
  const me = await api("/api/me");
  assert.equal(me.user.role, "owner"); assert.equal(me.user.name, "reviewer");
  assert.equal(me.user.email, provider === "forgejo" ? "" : "reviewer@example.test", "Only provider-verified email may be used");
  assert.equal((await api(`/api/reviews?org=${scope}`)).reviewed.length, 2);
  assert.equal((await fetch(`${app}/api/reviews?org=${scope}`)).status, 403);
  const publicSignup = await fetch(`${pb}/api/collections/users/records`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "attacker", role: "owner", password: "Some-Unused-Password-1!", passwordConfirm: "Some-Unused-Password-1!" }) });
  assert(!publicSignup.ok);
  const methods = await json(`${pb}/api/collections/users/auth-methods`); assert.equal(methods.password.enabled, false);
  for (const role of ["admin", "developer"]) {
    await json(`${pb}/api/collections/users/records/${me.user.id}`, { method: "PATCH", headers: { authorization: adminAuth.token }, body: { role } });
    const denied = await fetch(`${app}/api/settings/accounts`, { headers: { cookie: appCookie } }); assert.equal(denied.status, 403);
    const adminPage = await fetch(`${app}/api/settings/oauth`, { headers: { cookie: appCookie } }); assert.equal(adminPage.status, role === "admin" ? 200 : 403);
  }
  await json(`${pb}/api/collections/users/records/${me.user.id}`, { method: "PATCH", headers: { authorization: adminAuth.token }, body: { role: "owner" } });
  log("real Forgejo OAuth + PKCE login, verified-email handling, owner bootstrap, anonymous/admin/developer gates, OAuth-only account creation");

  const ghReview = await api(`/api/score?pr=${encodeURIComponent(githubPr.url)}&org=reviewer`);
  assert.equal(ghReview.pr.url, githubPr.url); assert.equal(ghReview.review.scores.quality, 60);
  assert.equal((await api("/api/reviews?org=reviewer")).reviewed[0].pr.url, githubPr.url);
  assert((await api(`/api/reviews?org=${scope}`)).reviewed.every((r) => r.pr.url.startsWith(forge)));
  // The real PocketBase GitHub provider talks to a local OAuth fixture, never GitHub.
  const collection = await json(`${pb}/api/collections/users`, { headers: { authorization: adminAuth.token } });
  await json(`${pb}/api/collections/users`, { method: "PATCH", headers: { authorization: adminAuth.token }, body: { oauth2: { ...collection.oauth2, providers: collection.oauth2.providers.map((p) => p.name === "github" ? { ...p, authURL: `http://127.0.0.1:${mp}/github/authorize`, tokenURL: `http://127.0.0.1:${mp}/github/token`, userInfoURL: `http://127.0.0.1:${mp}/github/user` } : p) } } });
  const githubFlow = await visit(`${app}/api/auth/start?provider=github`);
  await visit(JSON.parse(githubFlow.text).url);
  const ownerCookie = appCookie;
  appCookie = [...jars.get(app)].map(([k, v]) => `${k}=${v}`).join("; ");
  const ghMe = await api("/api/me");
  assert.equal(ghMe.user.name, "github-reviewer"); assert.equal(ghMe.user.role, "admin");
  assert.equal((await api(`/api/score?pr=${encodeURIComponent(prUrl)}&org=${scope}&force=1`)).pr.url, prUrl);
  appCookie = ownerCookie;
  log("GitHub review regression and simulated GitHub OAuth account reviewing real Forgejo PRs");
  await api("/api/settings/oauth", { oauth: { enabled: false } });
  assert.deepEqual((await api("/api/login")).providers.map((p) => p.id), [provider]);
  await api("/api/settings/oauth", { oauth: { enabled: true, clientId: "github-test-client", clientSecret: "github-test-secret" } });
  log("Forgejo-only sign-in remains available when GitHub OAuth is disabled");

  if (provider === "gitea") {
    // Real servers with the same owner/repo/PR numbers must never share credentials or data.
    const otherPort = await port(), other = `http://127.0.0.1:${otherPort}`;
    const otherContainer = `${container}-forgejo`;
    execFileSync("docker", ["run", "--detach", "--rm", "--name", otherContainer, "-p", `127.0.0.1:${otherPort}:3000`,
      "-e", "FORGEJO__security__INSTALL_LOCK=true", "-e", "FORGEJO__database__DB_TYPE=sqlite3",
      "-e", `FORGEJO__server__ROOT_URL=${other}/`, "-e", "FORGEJO__service__DISABLE_REGISTRATION=true",
      "codeberg.org/forgejo/forgejo:15"], { stdio: "pipe", windowsHide: true });
    extraContainers.push(otherContainer);
    await ready(`${other}/api/v1/version`);
    execFileSync("docker", ["exec", "--user", "git", otherContainer, "forgejo", "--config", "/data/gitea/conf/app.ini", "admin", "user", "create", "--username", "reviewer", "--password", password, "--email", "other@example.test", "--admin", "--must-change-password=false"], { stdio: "pipe", windowsHide: true });
    const otherApi = (path, options = {}) => json(`${other}/api/v1/${path}`, { ...options, headers: { authorization: basic } });
    const otherToken = await otherApi("users/reviewer/tokens", { method: "POST", body: { name: "isolated", scopes: ["read:user", "write:repository", "write:issue"] } });
    await otherApi("user/repos", { method: "POST", body: { name: "sample", auto_init: true, default_branch: "main", private: true } });
    await otherApi("repos/reviewer/sample/issues", { method: "POST", body: { title: "Separate issue" } });
    await otherApi("repos/reviewer/sample/contents/math.js", { method: "POST", body: { content: Buffer.from("export const add = (a, b) => a - b;\n").toString("base64"), new_branch: "fix", branch: "main" } });
    const otherPr = await otherApi("repos/reviewer/sample/pulls", { method: "POST", body: { title: "Separate Forgejo review", head: "fix", base: "main" } });
    assert.equal(otherPr.number, pr.number);
    const otherUrl = `${other}/reviewer/sample/pulls/${otherPr.number}`;
    await assert.rejects(api("/api/settings/oauth", { forgejo: { url: forge, token: otherToken.sha1 } }), /separate server origin/);
    await api("/api/settings/oauth", { forgejo: { url: other, token: otherToken.sha1 } });
    await api("/api/settings/oauth/testforgejo", {});
    await api("/api/settings/oauth/testgitea", {});
    await api(`/api/settings/repos?org=${scope}`, { repos: { list: [`${provider}~reviewer/sample`], add: `${other}/reviewer/sample` } });
    assert.equal((await api(`/api/score?pr=${encodeURIComponent(otherUrl)}&org=forgejo~reviewer`)).pr.title, "Separate Forgejo review");
    const allRepos = (await api(`/api/reviews?org=${scope}`)).repos;
    assert(allRepos.includes("reviewer/sample") && allRepos.includes("forgejo~reviewer/sample") && allRepos.includes("gitea~reviewer/sample"));
    assert((await api(`/api/reviews?org=${scope}`)).reviewed.every((r) => r.pr.url.startsWith(forge)));
    assert((await api("/api/reviews?org=forgejo~reviewer")).reviewed.every((r) => r.pr.url.startsWith(other)));
    await assert.rejects(api(`/api/score?pr=${encodeURIComponent(otherUrl)}&org=${scope}`));
    const otherOAuth = await otherApi("user/applications/oauth2", { method: "POST", body: { name: "Independent Forgejo login", redirect_uris: [`${app}/auth/callback`], confidential_client: true } });
    await api("/api/settings/oauth", { forgejooauth: { enabled: true, clientId: otherOAuth.client_id, clientSecret: otherOAuth.client_secret } });
    assert.deepEqual((await api("/api/login")).providers.map((p) => p.id), ["github", "forgejo", "gitea"]);
    appCookie = await oauthLogin("forgejo", other);
    const otherMe = await api("/api/me");
    assert.notEqual(otherMe.user.id, me.user.id, "Same usernames on different providers must not link identities");
    assert.equal(otherMe.user.role, "admin");
    assert.equal((await api(`/api/score?pr=${encodeURIComponent(prUrl)}&org=${scope}`)).pr.url, prUrl);
    appCookie = ownerCookie;
    await api("/api/settings/oauth", { forgejooauth: { enabled: false } });
    await assert.rejects(api("/api/settings/oauth", { forgejo: { url: "http://127.0.0.1:1" } }));
    assert.deepEqual((await api("/api/login")).providers.map((p) => p.id), ["github", "gitea"]);
    // Leave all providers enabled for optional browser QA.
    await api("/api/settings/oauth", { forgejooauth: { enabled: true, clientId: otherOAuth.client_id, clientSecret: otherOAuth.client_secret } });
    log("All three providers coexist: independent tokens, repositories, reviews, OAuth identities and provider toggles");
  }

  const fileDir = join(dir, "file-storage");
  mkdirSync(join(fileDir, "scores"), { recursive: true });
  mkdirSync(join(fileDir, "core"), { recursive: true }); cpSync(join(root, "package.json"), join(fileDir, "package.json"));
  for (const f of ["server.mjs", "models.json", "showcase.json"]) cpSync(join(root, "core", f), join(fileDir, "core", f));
  writeFileSync(join(fileDir, "config.json"), JSON.stringify({
    [provider]: { url: forge, token: token.sha1 },
    repos: ["reviewer/sample", `${provider}~reviewer/sample`],
    llm: { provider: "custom", model: "fixture", baseUrl: `http://127.0.0.1:${mp}/v1`, apiKey: "fixture" },
  }));
  const legacyPath = join(fileDir, "scores", "reviewer-sample-pull-7.json");
  const legacy = JSON.stringify({ pr: githubPr, at: new Date().toISOString(), review: { summary: "Legacy GitHub review", findings: [] } });
  writeFileSync(legacyPath, legacy);
  const filePort = await port();
  const fileApp = `http://127.0.0.1:${filePort}`;
  child(process.execPath, ["--import", pathToFileURL(preload).href, join(fileDir, "core", "server.mjs")], { cwd: fileDir, env: {
    ...process.env, PATH: "", Path: "", PB_URL: "", PORT: String(filePort), APP_URL: fileApp,
    FORGEJO_URL: "", FORGEJO_TOKEN: "", GITEA_URL: "", GITEA_TOKEN: "", REPO: "reviewer/sample", PR_SCORER_RECOVERY: "", PR_SCORER_DATA: join(fileDir, "local"),
  } });
  await ready(`${fileApp}/api/me`);
  const fileReview = await json(`${fileApp}/api/score?pr=${encodeURIComponent(prUrl)}&org=${scope}`);
  assert.equal(fileReview.pr.url, prUrl);
  assert.equal(fileReview.review.scores.quality, 60);
  const storedReview = JSON.parse(readFileSync(join(fileDir, "scores", `${createHash("sha256").update(prUrl).digest("hex")}.json`), "utf8"));
  assert.equal(storedReview.pr.url, prUrl);
  assert.equal(readFileSync(legacyPath, "utf8"), legacy);
  log("JSON storage reviews Forgejo with Windows-safe filenames and preserves legacy GitHub files");

  console.log(JSON.stringify({ app, forge, pb, user: "reviewer", password, fixture: dir, prUrl, container, pids: processes.map((p) => p.pid) }));
  if (process.argv.includes("--serve")) {
    console.log("Fixture ready for browser OAuth QA. Press Enter or Ctrl+C to clean up.");
    await new Promise((r) => { process.once("SIGINT", r); process.once("SIGTERM", r); process.stdin.once("data", r); process.stdin.resume(); });
    process.stdin.pause();
  }
  assert.equal(backend.exitCode, null, backend.testOutput());
} catch (e) {
  console.error(e);
  for (const p of processes) if (p.exitCode !== null) console.error(p.testOutput());
  process.exitCode = 1;
} finally {
  await cleanup();
}
