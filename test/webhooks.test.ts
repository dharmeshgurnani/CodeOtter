// Webhooks and the shared PR queue: signature checks, delivery de-duplication, routing into the queue, review retries,
// comment commands once (webhook or poll), forge hook registration. Runs the real <pr-events>..</forge-hooks> blocks from
// server.ts with storage, forges, gh and the review engines stubbed.
import assert from "node:assert";
import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { test } from "node:test";
import { serverBlocks } from "./helpers/server-blocks.ts";
import { makeForge, secretMatches, type ForgeConfig } from "../core/forges.ts";

// What the evaluated blocks return, as far as the tests use it.
type Headers = Record<string, string | undefined>;
type Failure = { sha?: string; at: number; tries: number; error?: string };
interface Queue {
  verifySignature: (secret: string, raw: Buffer, signature: string | undefined) => boolean;
  handleWebhook: (src: string, headers: Headers, raw: Buffer) => Promise<{ status: number; body: unknown }>;
  enqueuePr: (repo: string, pr: { url: string; headRefOid: string }) => void;
  webhookHealthy: (src: string) => boolean;
  pollDue: (src: string) => boolean;
  ensureForgeHook: (repo: string) => Promise<boolean>;
  reposChanged: (before: string[], after: string[]) => Promise<void>;
  forwarderStatus: () => string;
  HANDLED_COMMENTS: Set<string>;
  lastCatchUp: Record<string, number>;
  pending: () => unknown;
}

test("Webhooks and the PR queue", async () => {

const block = serverBlocks("pr-events", "webhooks", "forwarder", "forge-hooks");

function load({ scoreFails = false, repos = ["acme/app", "gitea~acme/lib", "bitbucket~team/app", "azure~contoso/Web Shop/api"], trusted = true } = {}) {
  const settings = new Map<string, unknown>([["review", { auto: true, commands: true }], ["triage", { auto: false }], ["githubApp", { webhookSecret: "gh-secret" }], ["giteaWebhook", { secret: "gt-secret" }], ["bitbucketWebhook", { secret: "bb-secret" }], ["azureWebhook", { secret: "az-secret" }]]);
  const calls: unknown[][] = [];
  const forgeHooks: { id: number; config: { url: string; secret: string } }[] = [];
  const FORGES: Record<string, Omit<ForgeConfig, "token"> & { token?: string }> = {
    forgejo: { kind: "gitea", label: "Forgejo", url: "" },
    gitea: { kind: "gitea", label: "Gitea", url: "https://git.example", token: "t" },
    bitbucket: { kind: "bitbucket", label: "Bitbucket", fixed: true, url: "https://bitbucket.org", token: "t" },
    azure: { kind: "azure", label: "Azure DevOps", fixed: true, url: "https://dev.azure.com", token: "t", orgs: ["contoso"] },
  };
  const FORGE_API = Object.fromEntries(Object.keys(FORGES).map((id) => [id, makeForge(id, FORGES[id] as ForgeConfig)]));
  // the git server API behind the adapters: Gitea's repository hooks
  const stubFetch: typeof fetch = async (url, init = {}) => {
    const method = init.method || "GET";
    const path = new URL(String(url)).pathname.replace(/^\/api\/v1\//, "");
    calls.push(["forge", method, path]);
    if (path.endsWith("/hooks") && method === "POST") { forgeHooks.push({ id: forgeHooks.length + 1, config: JSON.parse(String(init.body)).config }); return Response.json(forgeHooks.at(-1)); }
    if (path.endsWith("/hooks")) return Response.json(forgeHooks);
    if (method === "DELETE") { forgeHooks.splice(0); return new Response(null, { status: 204 }); }
    return Response.json({});
  };
  globalThis.fetch = stubFetch;
  const stubs: Record<string, unknown> = {
    SHA_RE: /^[0-9a-f]{7,40}$/i,
    REPO_RE: /^(?:(?:(?:forgejo|gitea|bitbucket|bitbucketdc)~)?[\w][\w.-]*\/[\w][\w.-]*|azure~[\w][\w.-]*\/[\w](?:[\w. -]*[\w.-])?\/[\w](?:[\w. -]*[\w.-])?)$/,
    FORGES, FORGE_API, secretMatches,
    forgeOf: (r: string) => FORGE_API[/^([a-z]+)~/.exec(r)?.[1] ?? ""],
    APP_URL: "https://otter.example",
    PORT: 4747,
    IS_SERVER: false,
    createHmac, timingSafeEqual, randomBytes,
    spawn: () => { throw new Error("no spawn in tests"); },
    fetch: async () => { throw new Error("no network in tests"); },
    createGitHubAppJwt: () => "jwt",
    forgetGithubRepos: () => {},
    store: { getSetting: async (k: string) => settings.get(k) ?? null, setSetting: async (k: string, v: unknown) => { settings.set(k, v); } },
    triageConfig: async () => ({ auto: false, ...(settings.get("triage") || {}) }),
    reviewConfig: async () => ({ auto: false, commands: false, ...(settings.get("review") || {}) }),
    repoOf: (pr: { url: string }) => String(pr.url).replace("https://github.com/", "").split("/pull/")[0],
    ghEnv: () => process.env,
    repos: async () => repos,
    openPrs: async () => [],
    forgeId: (r: string) => /^([a-z]+)~/.exec(r)?.[1] || "",
    isForgeRepo: (r: string) => /^[a-z]+~/.test(r),
    nativeRepo: (r: string) => r.replace(/^[a-z]+~/, ""),
    oneLine: (x: unknown, max: number) => String(x).replace(/\s+/g, " ").slice(0, max),
    triagePr: async (url: string) => { calls.push(["triage", url]); },
    score: async (url: string, _force: boolean, repo: string) => { calls.push(["score", url, repo]); if (scoreFails) throw new Error("model down"); return { pr: { url } }; },
    syncPrComments: async (r: { pr: { url: string } }) => { calls.push(["sync", r.pr.url]); },
    normalizeForgePr: (p: { number: number; head?: { sha?: string }; draft?: boolean }, repo: string) => ({ url: `https://git.example/${repo.slice(6)}/pulls/${p.number}`, headRefOid: p.head?.sha, isDraft: !!p.draft, labels: [] }),
    parseCommand: (body: unknown) => { const m = String(body || "").match(/^\/(review|ask)(?:\s+(.*))?$/); return m ? { cmd: m[1], arg: m[2] || "" } : null; },
    commentPrNumber: (c: { prNumber?: unknown; html_url?: unknown } | undefined) => Number(c?.prNumber) || Number((String(c?.html_url || "").match(/\/pulls?\/(\d+)/) || [])[1]) || 0,
    commenterTrusted: async () => trusted,
    runCommand: async (repo: string, c: { id: unknown }, cmd: { cmd: string }) => { calls.push(["command", repo, c.id, cmd.cmd]); },
  };
  const names = Object.keys(stubs);
  const api = new Function(...names, `${block}; return { verifySignature, handleWebhook, routeWebhook, enqueuePr, webhookHealthy, pollDue, noteDelivery, ensureForgeHook, removeForgeHook, reposChanged, forwarderStatus, PR_QUEUE, WEBHOOK_LAST, HANDLED_COMMENTS, lastCatchUp, pending: () => PR_QUEUE.size || prDraining };`)(...names.map((n) => stubs[n])) as Queue;
  return { ...api, calls, settings, forgeHooks };
}

const sign = (secret: string, body: string | Buffer, prefix = "sha256=") => prefix + createHmac("sha256", secret).update(body).digest("hex");
async function deliver(api: Queue, src: string, { event, body, secret, delivery = randomBytes(8).toString("hex"), prefix }: { event?: string; body?: unknown; secret?: string; delivery?: string; prefix?: string } = {}) {
  const raw = Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
  const sigHeader = src === "github" ? "x-hub-signature-256" : `x-${src}-signature`;
  const headers: Headers = { [`x-${src}-event`]: event, [`x-${src}-delivery`]: delivery, ...(secret ? { [sigHeader]: sign(secret, raw, prefix ?? (src === "github" ? "sha256=" : "")) } : {}) };
  const { status, body: reply } = await api.handleWebhook(src, headers, raw);
  return { statusCode: status, body: reply };
}
// Wait for the PR queue to drain, then a few ticks for work that runs outside it (comment commands).
const settle = async (api: Queue) => { for (let i = 0; i < 100 && api.pending(); i++) await new Promise((r) => setTimeout(r, 5)); await new Promise((r) => setTimeout(r, 30)); };

// signatures
{
  const { verifySignature } = load();
  assert.ok(verifySignature("s", Buffer.from("x"), sign("s", "x")));
  assert.ok(verifySignature("s", Buffer.from("x"), sign("s", "x", "")), "forge style, no prefix");
  assert.ok(!verifySignature("s", Buffer.from("x"), sign("other", "x")));
  assert.ok(!verifySignature("s", Buffer.from("x"), undefined));
  assert.ok(!verifySignature("", Buffer.from("x"), sign("", "x")));
  console.log("✓ HMAC-SHA256 signatures, with and without the sha256= prefix");
}

// refusals happen before any work
{
  const api = load();
  const pr = { action: "opened", repository: { full_name: "acme/app" }, pull_request: { number: 7, html_url: "https://github.com/acme/app/pull/7", head: { sha: "a".repeat(40) } } };
  assert.strictEqual((await deliver(api, "github", { event: "pull_request", body: pr, secret: "wrong" })).statusCode, 401);
  assert.strictEqual((await deliver(api, "github", { event: "pull_request", body: pr })).statusCode, 401);
  assert.strictEqual((await deliver(api, "github", { event: "pull_request", body: "{nope", secret: "gh-secret" })).statusCode, 400);
  assert.strictEqual((await deliver(api, "forgejo", { event: "pull_request", body: pr, secret: "x" })).statusCode, 404, "unconfigured forge");
  api.settings.set("githubApp", {});
  assert.strictEqual((await deliver(api, "github", { event: "pull_request", body: pr, secret: "gh-secret" })).statusCode, 503, "no secret stored");
  await settle(api);
  assert.deepStrictEqual(api.calls, []);
  console.log("✓ bad signature 401, bad JSON 400, unconfigured forge 404, missing secret 503, nothing runs");
}

// the GitHub Action signs with the instance's action secret and posts the workflow's own event payload
{
  const api = load();
  api.settings.set("githubApp", { actionSecret: "act-secret" });
  const pr = { action: "opened", repository: { full_name: "acme/app" }, pull_request: { number: 9, html_url: "https://github.com/acme/app/pull/9", head: { sha: "c".repeat(40) } } };
  assert.strictEqual((await deliver(api, "github", { event: "pull_request", body: pr, secret: "act-secret", delivery: "action-1-1" })).statusCode, 202);
  await settle(api);
  assert.deepStrictEqual(api.calls[0], ["score", "https://github.com/acme/app/pull/9", "acme/app"]);
  console.log("✓ GitHub Action deliveries signed with the action secret are queued like App deliveries");
}

// a pull_request delivery is accepted, de-duplicated and reviewed once per head
{
  const api = load();
  const pr = { action: "synchronize", repository: { full_name: "acme/app" }, pull_request: { number: 7, html_url: "https://github.com/acme/app/pull/7", head: { sha: "a".repeat(40) }, draft: false, labels: [] } };
  const res = await deliver(api, "github", { event: "pull_request", body: pr, secret: "gh-secret", delivery: "d1" });
  assert.strictEqual(res.statusCode, 202);
  await deliver(api, "github", { event: "pull_request", body: pr, secret: "gh-secret", delivery: "d1" }); // GitHub redelivery
  await deliver(api, "github", { event: "pull_request", body: pr, secret: "gh-secret", delivery: "d2" }); // same head, new delivery
  await settle(api);
  assert.deepStrictEqual(api.calls, [["score", "https://github.com/acme/app/pull/7", "acme/app"], ["sync", "https://github.com/acme/app/pull/7"]]);
  assert.strictEqual((api.settings.get("autoReviewed") as Record<string, string>)["https://github.com/acme/app/pull/7"], "a".repeat(40));
  assert.ok(api.webhookHealthy("github") && !api.webhookHealthy("gitea"));
  assert.ok(api.pollDue("github"), "a catch-up is still due until one has run");
  api.lastCatchUp.github = Date.now();
  assert.ok(!api.pollDue("github") && api.pollDue("gitea"), "poll backs off for a forge with recent deliveries");
  console.log("✓ pull_request accepted with 202, duplicate delivery and same head ignored, head reviewed once");
}

// ignored events and repositories
{
  const api = load();
  const mk = (over: Record<string, unknown>) => ({ action: "opened", repository: { full_name: "acme/app" }, pull_request: { number: 1, html_url: "https://github.com/acme/app/pull/1", head: { sha: "b".repeat(40) } }, ...over });
  await deliver(api, "github", { event: "pull_request", body: mk({ repository: { full_name: "other/repo" } }), secret: "gh-secret" });
  await deliver(api, "github", { event: "pull_request", body: mk({ action: "closed" }), secret: "gh-secret" });
  await deliver(api, "github", { event: "pull_request", body: mk({ action: "labeled" }), secret: "gh-secret" });
  await deliver(api, "github", { event: "pull_request", body: mk({ pull_request: { number: 1, html_url: "https://github.com/acme/app/pull/1", head: { sha: "b".repeat(40) }, draft: true } }), secret: "gh-secret" });
  await deliver(api, "github", { event: "pull_request", body: mk({ pull_request: { number: 1, html_url: "https://github.com/acme/app/pull/1", head: { sha: "not a sha" } } }), secret: "gh-secret" });
  await deliver(api, "github", { event: "ping", body: { zen: "x" }, secret: "gh-secret" });
  await deliver(api, "github", { event: "installation_repositories", body: { action: "added" }, secret: "gh-secret" });
  await settle(api);
  assert.deepStrictEqual(api.calls, []);
  console.log("✓ other repositories, closed/labeled, drafts, bad SHAs, ping and installation events run nothing");
}

// a failed review is retried, not marked done
{
  const api = load({ scoreFails: true });
  const p = { url: "https://github.com/acme/app/pull/9", headRefOid: "c".repeat(40) };
  api.enqueuePr("acme/app", p);
  await settle(api);
  api.enqueuePr("acme/app", p); // poll two minutes later: inside the retry window
  await settle(api);
  const failures = () => api.settings.get("autoReviewFailed") as Record<string, Failure>;
  const failed = failures()[p.url];
  assert.strictEqual(failed.tries, 1);
  assert.strictEqual(failed.error, "model down");
  assert.strictEqual((api.settings.get("autoReviewed") as Record<string, string> | undefined)?.[p.url], undefined);
  assert.strictEqual(api.calls.filter((c) => c[0] === "score").length, 1, "no second try inside ten minutes");
  failures()[p.url].at -= 11 * 60e3;
  api.enqueuePr("acme/app", p);
  await settle(api);
  assert.strictEqual(api.calls.filter((c) => c[0] === "score").length, 2, "retried after the window");
  assert.strictEqual(failures()[p.url].tries, 2);
  failures()[p.url] = { sha: p.headRefOid, at: 0, tries: 3 };
  api.enqueuePr("acme/app", p);
  await settle(api);
  assert.strictEqual(api.calls.filter((c) => c[0] === "score").length, 2, "gives up after three tries");
  api.enqueuePr("acme/app", { ...p, headRefOid: "d".repeat(40) });
  await settle(api);
  assert.strictEqual(api.calls.filter((c) => c[0] === "score").length, 3, "a new head starts over");
  console.log("✓ failed reviews retry three times, ten minutes apart, and a new head starts over");
}

// comment commands run once, whether the webhook or the poll sees the comment first
{
  const api = load();
  const c = { id: 55, body: "/review", html_url: "https://github.com/acme/app/pull/7#issuecomment-55", created_at: "2026-11-01T10:00:00Z", author_association: "MEMBER" };
  const body = { action: "created", repository: { full_name: "acme/app" }, issue: { number: 7, pull_request: {} }, comment: c };
  await deliver(api, "github", { event: "issue_comment", body, secret: "gh-secret", delivery: "e1" });
  await deliver(api, "github", { event: "issue_comment", body, secret: "gh-secret", delivery: "e2" });
  await deliver(api, "github", { event: "issue_comment", body: { ...body, action: "edited" }, secret: "gh-secret" });
  await deliver(api, "github", { event: "issue_comment", body: { ...body, issue: { number: 3 } }, secret: "gh-secret" }); // an issue, not a PR
  await settle(api);
  assert.deepStrictEqual(api.calls, [["command", "acme/app", 55, "review"]]);
  assert.ok(!api.HANDLED_COMMENTS.has("acme/app#56"));
  assert.ok(api.HANDLED_COMMENTS.has("acme/app#55"), "the poll skips a comment the webhook handled");
  assert.strictEqual((api.settings.get("commandsSeen") as Record<string, string>)["acme/app"], "2026-11-01T10:00:00.000Z", "the poll bookmark moves past it");
  const untrusted = load({ trusted: false });
  await deliver(untrusted, "github", { event: "issue_comment", body, secret: "gh-secret" });
  await settle(untrusted);
  assert.deepStrictEqual(untrusted.calls, []);
  const off = load();
  off.settings.set("review", { auto: true, commands: false });
  await deliver(off, "github", { event: "issue_comment", body, secret: "gh-secret" });
  await settle(off);
  assert.deepStrictEqual(off.calls, []);
  console.log("✓ a command comment runs once, never for issues, outsiders or when commands are off");
}

// Gitea: hex signature without prefix, synchronized action, PR comments flagged with is_pull
{
  const api = load();
  const body = { action: "synchronized", repository: { full_name: "acme/lib" }, pull_request: { number: 4, head: { sha: "e".repeat(40) } } };
  assert.strictEqual((await deliver(api, "gitea", { event: "pull_request", body, secret: "gt-secret" })).statusCode, 202);
  assert.strictEqual((await deliver(api, "gitea", { event: "pull_request", body, secret: "gh-secret" })).statusCode, 401, "GitHub's secret does not open the Gitea door");
  const comment = { action: "created", repository: { full_name: "acme/lib" }, is_pull: true, issue: { number: 4 }, comment: { id: 9, body: "/ask why", html_url: "https://git.example/acme/lib/pulls/4#issuecomment-9", created_at: "2026-11-01T11:00:00Z" } };
  await deliver(api, "gitea", { event: "issue_comment", body: comment, secret: "gt-secret" });
  await settle(api);
  assert.deepStrictEqual(api.calls, [["score", "https://git.example/acme/lib/pulls/4", "gitea~acme/lib"], ["sync", "https://git.example/acme/lib/pulls/4"], ["command", "gitea~acme/lib", 9, "ask"]]);
  console.log("✓ Gitea deliveries: hex signature, synchronized, is_pull comments, per-forge secrets");
}

// forge hooks are registered once per repository and removed when the repository leaves
{
  const api = load();
  assert.strictEqual(await api.ensureForgeHook("gitea~acme/lib"), true);
  assert.strictEqual(await api.ensureForgeHook("gitea~acme/lib"), false, "existing hook recognised by URL");
  assert.strictEqual(api.forgeHooks.length, 1);
  assert.strictEqual(api.forgeHooks[0].config.url, "https://otter.example/webhooks/gitea");
  assert.strictEqual(api.forgeHooks[0].config.secret, "gt-secret", "the stored forge secret is reused");
  await api.reposChanged(["gitea~acme/lib", "acme/app"], ["acme/app"]);
  assert.strictEqual(api.forgeHooks.length, 0, "hook deleted when the repository is removed");
  assert.ok(api.calls.some((c) => c[0] === "forge" && c[1] === "DELETE"));
  const fresh = load();
  fresh.settings.delete("giteaWebhook");
  await fresh.ensureForgeHook("gitea~acme/lib");
  assert.match((fresh.settings.get("giteaWebhook") as { secret: string }).secret, /^[0-9a-f]{48}$/, "a secret is generated once");
  assert.strictEqual(fresh.forwarderStatus(), "Off");
  console.log("✓ Forgejo/Gitea repository hooks: created once, secret generated once, removed with the repository");
}

// Bitbucket Cloud: X-Event-Key, X-Request-UUID and an X-Hub-Signature with the sha256= prefix
{
  const api = load();
  const repo = { full_name: "team/app", links: { html: { href: "https://bitbucket.org/team/app" } } };
  const pr = { id: 5, title: "Add cart", state: "OPEN", author: { nickname: "dev" }, source: { branch: { name: "feat" }, commit: { hash: "abc123def456" }, repository: repo }, destination: { branch: { name: "main" }, repository: repo } };
  const send = (event: string, body: unknown, secret = "bb-secret", delivery = randomBytes(8).toString("hex")) => {
    const raw = Buffer.from(JSON.stringify(body));
    const headers = { "x-event-key": event, "x-request-uuid": delivery, "x-hub-signature": sign(secret, raw) };
    return api.handleWebhook("bitbucket", headers, raw).then((r) => ({ statusCode: r.status, body: r.body }));
  };
  assert.strictEqual((await send("pullrequest:updated", { pullrequest: pr, repository: repo }, "gt-secret")).statusCode, 401, "another forge's secret");
  assert.strictEqual((await send("pullrequest:updated", { pullrequest: pr, repository: repo }, "bb-secret", "u1")).statusCode, 202);
  await send("pullrequest:updated", { pullrequest: pr, repository: repo }, "bb-secret", "u1"); // redelivery
  await send("pullrequest:fulfilled", { pullrequest: { ...pr, state: "MERGED" }, repository: repo });
  await send("pullrequest:updated", { pullrequest: { ...pr, state: "DECLINED" }, repository: repo });
  const other = { full_name: "team/other", links: { html: { href: "https://bitbucket.org/team/other" } } };
  await send("pullrequest:created", { pullrequest: { ...pr, destination: { branch: { name: "main" }, repository: other } }, repository: other });
  await send("pullrequest:comment_created", { pullrequest: pr, repository: repo, comment: { id: 81, content: { raw: "/review" }, user: { account_id: "acc-1", nickname: "lead" }, created_on: "2026-11-02T09:00:00Z" } });
  await send("pullrequest:comment_created", { pullrequest: pr, repository: repo, comment: { id: 82, content: { raw: "/review" }, deleted: true, created_on: "2026-11-02T09:01:00Z" } });
  await settle(api);
  assert.deepStrictEqual(api.calls, [["score", "https://bitbucket.org/team/app/pull-requests/5", "bitbucket~team/app"], ["sync", "https://bitbucket.org/team/app/pull-requests/5"], ["command", "bitbucket~team/app", 81, "review"]]);
  console.log("✓ Bitbucket deliveries: signed, de-duplicated, open PRs only, onboarded repositories only, comment commands");
}

// Azure DevOps: no signature, the secret in X-CodeOtter-Secret; event and delivery id come from the body
{
  const api = load();
  const repository = { webUrl: "https://dev.azure.com/contoso/Web%20Shop/_git/api" };
  const pr = { pullRequestId: 31, status: "active", title: "Fix tax", sourceRefName: "refs/heads/fix", targetRefName: "refs/heads/main", lastMergeSourceCommit: { commitId: "f".repeat(40) }, createdBy: { uniqueName: "dev@contoso.com" }, repository };
  const send = (body: unknown, secret = "az-secret") => {
    const headers = secret ? { "x-codeotter-secret": secret } : {};
    return api.handleWebhook("azure", headers, Buffer.from(JSON.stringify(body))).then((r) => ({ statusCode: r.status, body: r.body }));
  };
  const updated = { id: "evt-1", eventType: "git.pullrequest.updated", resource: pr };
  assert.strictEqual((await send(updated, "")).statusCode, 401);
  assert.strictEqual((await send(updated, "az-secre")).statusCode, 401, "a prefix of the secret is not the secret");
  assert.strictEqual((await send(updated, "bb-secret")).statusCode, 401);
  assert.strictEqual((await send(updated)).statusCode, 202);
  await send(updated); // same notification id
  await send({ id: "evt-2", eventType: "git.pullrequest.updated", resource: { ...pr, status: "completed" } });
  await send({ id: "evt-3", eventType: "git.pullrequest.updated", resource: { ...pr, repository: { webUrl: "https://dev.azure.com/contoso/Web%20Shop/_git/other" } } });
  await send({ id: "evt-4", eventType: "ms.vss-code.git-pullrequest-comment-event", resource: { pullRequest: pr, comment: { id: 2, content: "/ask why", publishedDate: "2026-11-02T10:00:00Z", author: { id: "u-1", uniqueName: "lead@contoso.com" }, _links: { threads: { href: "https://dev.azure.com/contoso/_apis/git/repositories/r1/pullRequests/31/threads/77" } } } } });
  await settle(api);
  assert.deepStrictEqual(api.calls, [["score", "https://dev.azure.com/contoso/Web%20Shop/_git/api/pullrequest/31", "azure~contoso/Web Shop/api"], ["sync", "https://dev.azure.com/contoso/Web%20Shop/_git/api/pullrequest/31"], ["command", "azure~contoso/Web Shop/api", "77:2", "ask"]]);
  console.log("✓ Azure DevOps deliveries: shared-secret header, notification ids de-duplicated, active PRs only, thread comments");
}

console.log("All webhook tests passed");

});
