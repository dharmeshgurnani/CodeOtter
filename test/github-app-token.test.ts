// gh calls on an install whose only GitHub credential is the App made in onboarding: which owner a call names, and the
// installation token for that owner (looked up, cached, never guessed between installations). fetch is stubbed.
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("GitHub App installation token for gh calls", async (ctx) => {
  process.env.CODEOTTER_HOME = mkdtempSync(join(tmpdir(), "co-apptoken-"));
  delete process.env.PB_URL;
  const { ghOwnerOf, appInstallationToken, forgetGithubRepos } = await import("../core/git.ts");
  const { store } = await import("../core/store.ts");

  assert.equal(ghOwnerOf(["pr", "list", "-R", "acme/web", "--json", "number"]), "acme");
  assert.equal(ghOwnerOf(["pr", "view", "https://github.com/acme/web/pull/7", "--json", "title"]), "acme");
  assert.equal(ghOwnerOf(["api", "--method", "POST", "repos/Acme-Co/web/statuses/abc", "-f", "state=success"]), "Acme-Co");
  assert.equal(ghOwnerOf(["api", "search/code?q=repo:acme/web+parseThing&per_page=5"]), "acme");
  assert.equal(ghOwnerOf(["repo", "view", "acme/web", "--json", "nameWithOwner"]), "acme");
  assert.equal(ghOwnerOf(["repo", "list", "acme", "--limit", "100"]), "acme");
  assert.equal(ghOwnerOf(["api", "user", "--jq", ".login"]), "");
  assert.equal(ghOwnerOf(["repo", "list", "--limit", "1"]), "");
  ctx.diagnostic("the owner comes from -R, a PR URL, an api path, a search qualifier or gh repo view|list");

  assert.equal(await appInstallationToken("acme"), "", "no App saved: no token");
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  await store.setSetting("githubApp", { id: 42, pem: privateKey.export({ type: "pkcs1", format: "pem" }).toString() });

  const calls: string[] = [];
  let installs = [{ id: 1, account: { login: "Acme" } }, { id: 2, account: { login: "other" } }];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method || "GET"} ${url}`);
    assert.match(String((init?.headers as Record<string, string>).authorization), /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/, "App JWT");
    assert.equal(init?.redirect, "error");
    if (url.endsWith("/app/installations?per_page=100")) return new Response(JSON.stringify(installs));
    const m = /\/app\/installations\/(\d+)\/access_tokens$/.exec(url);
    if (m) return new Response(JSON.stringify({ token: `ghs_inst${m[1]}`, expires_at: new Date(Date.now() + 3600000).toISOString() }), { status: 201 });
    return new Response("{}", { status: 404 });
  }) as typeof fetch;

  assert.equal(await appInstallationToken("acme"), "ghs_inst1", "owner matched case-insensitively");
  assert.equal(await appInstallationToken("ACME"), "ghs_inst1");
  assert.equal(calls.length, 2, "second call is served from the cache");
  assert.equal(await appInstallationToken("other"), "ghs_inst2");
  assert.equal(await appInstallationToken("stranger"), "", "an owner without an installation gets nothing");
  assert.equal(await appInstallationToken(""), "", "no owner and several installations: never guess");
  installs = [{ id: 9, account: { login: "solo" } }];
  assert.equal(await appInstallationToken(""), "ghs_inst9", "no owner and one installation: that one");
  ctx.diagnostic("installation tokens per owner, cached, and never guessed between installations");

  const before = calls.length;
  forgetGithubRepos();
  assert.equal(await appInstallationToken("solo"), "ghs_inst9");
  assert.ok(calls.length > before, "forgetGithubRepos (new App or install) drops cached tokens");
  ctx.diagnostic("a new App or installation drops the cached tokens");
});
