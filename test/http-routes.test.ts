// The HTTP app through app.request(): no server, no port. A temp CODEOTTER_HOME with file storage, PATH cut down to node's
// own directory so neither a local PocketBase nor gh is found, and outbound fetch refused.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

test("http routes", async (ctx) => {
  const home = mkdtempSync(join(tmpdir(), "codeotter-http-"));
  Object.assign(process.env, { CODEOTTER_HOME: home, PATH: dirname(process.execPath), REPO: "acme/api", CODEOTTER_UPDATE_CHECK: "0" });
  delete process.env.PB_URL;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => { throw new Error(`unexpected fetch ${url}`); };
  ctx.after(() => { globalThis.fetch = realFetch; rmSync(home, { recursive: true, force: true }); });

  const { initializeCore } = await import("../core/server.ts");
  const { app } = await import("../core/app.ts");
  await initializeCore();
  const json = async (res: Response): Promise<[number, Record<string, unknown>]> => [res.status, (await res.json()) as Record<string, unknown>];

  {
    const [status, body] = await json(await app.request("/healthz"));
    assert.equal(status, 200);
    assert.deepEqual(body.storage, { kind: "files", ok: true });
  }
  ctx.diagnostic("healthz reports file storage");

  {
    const res = await app.request("/api/me", { headers: { "sec-fetch-site": "cross-site" } });
    assert.deepEqual(await json(res), [403, { error: "Cross-site request refused" }]);
    assert.equal((await app.request("/score?pr=1", { headers: { "sec-fetch-site": "cross-site" } })).status, 403);
    assert.equal((await app.request("/api/me", { headers: { "sec-fetch-site": "same-origin" } })).status, 200);
  }
  ctx.diagnostic("cross-site requests to /api and /score are refused");

  {
    assert.deepEqual(await json(await app.request("/api/nope")), [404, { error: "Not found" }]);
    assert.deepEqual(await json(await app.request("/api/learnings")), [404, { error: "Not found" }], "GET on a POST-only route");
    assert.deepEqual(await json(await app.request("/api/settings/nope")), [500, { error: "No settings page nope" }]);
    assert.deepEqual(await json(await app.request("/api/settings/repos/x")), [405, { error: "POST only" }]);
    assert.deepEqual(await json(await app.request("/api/settings/git/test", { method: "POST" })), [500, { error: "No action test on git" }]);
  }
  ctx.diagnostic("unknown /api paths are JSON 404s; unknown settings pages and GET on actions are refused");

  {
    const big = JSON.stringify({ rule: "x".repeat(1_100_000) });
    const res = await app.request("/api/learnings", { method: "POST", body: big, headers: { "content-type": "application/json" } });
    assert.deepEqual(await json(res), [413, { error: "Request body too large" }]);
  }
  ctx.diagnostic("API bodies over 1 MB are refused with 413");

  {
    assert.deepEqual(await json(await app.request("/webhooks/github")), [405, { error: "POST only" }]);
    const res = await app.request("/webhooks/github", { method: "POST", body: "{}", headers: { "x-github-event": "ping", "x-github-delivery": "d1" } });
    assert.deepEqual(await json(res), [503, { error: "No github webhook secret configured (Admin / Git providers)" }]);
    assert.deepEqual(await json(await app.request("/webhooks/forgejo", { method: "POST", body: "{}" })), [404, { error: "Forgejo is not configured" }]);
    assert.equal((await app.request("/webhooks/gitlab", { method: "POST", body: "{}" })).status, 404, "unknown source");
  }
  ctx.diagnostic("webhooks: POST only, unconfigured sources and missing secrets refused before any work");

  {
    // file storage has no accounts: the single operator is owner, so gated routes answer
    const [status, body] = await json(await app.request("/api/reviews?org=acme"));
    assert.equal(status, 200);
    assert.equal(body.store, "files");
    assert.deepEqual(await json(await app.request("/api/reviews?org=acme/shop")), [500, { error: "Bad organization" }]);
    const settings = await app.request("/api/settings/repos");
    assert.equal(settings.status, 200);
    assert.ok(Array.isArray(((await settings.json()) as { sections?: unknown }).sections));
  }
  ctx.diagnostic("gated routes answer the operator in file mode; ?org= is validated");

  {
    const res = await app.request("/api/hf-avatar?owner=qwen");
    assert.equal(res.status, 302);
    assert.match(res.headers.get("location") ?? "", /cdn-avatars\.huggingface\.co/);
    assert.equal(res.headers.get("cache-control"), "public, max-age=86400");
    const fav = await app.request("/favicon.svg");
    assert.equal(fav.status, 200);
    assert.equal(fav.headers.get("content-type"), "image/svg+xml; charset=utf-8");
  }
  ctx.diagnostic("avatar redirect keeps its cache header; favicon is served");
});
