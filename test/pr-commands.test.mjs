// PR comment commands: parsing, who may trigger, and what each command does. Runs the real <pr-commands> block from
// server.mjs with forge, gh, review and tool calls stubbed.
import assert from "node:assert";
import { serverBlock } from "./helpers/server-blocks.mjs";
import { test } from "node:test";

test("PR comment commands", async (ctx) => {

const block = serverBlock("pr-commands");

function load({ forgePermission = "write", forgeStatus = 0, toolFails = false } = {}) {
  const calls = [];
  const stubs = {
    isForgeRepo: (r) => r.startsWith("forgejo~"),
    prUrlFor: (repo, n) => (repo.startsWith("forgejo~") ? `https://git.example/${repo.slice(8)}/pulls/${n}` : `https://github.com/${repo}/pull/${n}`),
    oneLine: (x, max) => String(x).replace(/\s+/g, " ").slice(0, max),
    forgeApi: async (path, opts) => {
      calls.push(["forge", path, opts?.body]);
      if (path.endsWith("/permission")) { if (forgeStatus) throw Object.assign(new Error("x"), { status: forgeStatus }); return { permission: forgePermission }; }
      return [];
    },
    ghAsync: async (...a) => { calls.push(["gh", ...a]); return "[]"; },
    score: async (url, force, repo) => { calls.push(["score", url, force, repo]); return { pr: { url } }; },
    syncPrComments: async (r, repo, opts) => { calls.push(["sync", r.pr.url, repo, opts]); return []; },
    runPrTool: async (url, id, opts) => { calls.push(["tool", url, id, opts]); if (toolFails) throw new Error("model said no"); return {}; },
    createPrComment: async (url, repo, n, body) => { calls.push(["comment", url, n, body]); },
  };
  const names = Object.keys(stubs);
  const api = new Function(...names, `${block}; return { parseCommand, commentPrNumber, commenterTrusted, commentsSince, runCommand };`)(...names.map((n) => stubs[n]));
  return { ...api, calls };
}

const { parseCommand, commentPrNumber } = load();
assert.deepStrictEqual(parseCommand("/review"), { cmd: "review", arg: "" });
assert.deepStrictEqual(parseCommand("  /Ask   why does total add tax?  \nmore text"), { cmd: "ask", arg: "why does total add tax?" });
assert.deepStrictEqual(parseCommand("/describe\r\n"), { cmd: "describe", arg: "" });
assert.strictEqual(parseCommand("please /review"), null);
assert.strictEqual(parseCommand("/deploy prod"), null);
assert.strictEqual(parseCommand("/reviewer"), null);
assert.strictEqual(parseCommand(""), null);
ctx.diagnostic("parses commands on the first line only");

assert.strictEqual(commentPrNumber({ html_url: "https://github.com/acme/shop/pull/7#issuecomment-1" }), 7);
assert.strictEqual(commentPrNumber({ html_url: "https://git.example/acme/shop/pulls/12#issuecomment-3" }), 12);
assert.strictEqual(commentPrNumber({ html_url: "https://github.com/acme/shop/issues/7#issuecomment-1" }), 0, "issues are ignored");
ctx.diagnostic("only pull request comments");

// Who may trigger.
const gh = load();
for (const [assoc, ok] of [["OWNER", true], ["MEMBER", true], ["COLLABORATOR", true], ["CONTRIBUTOR", false], ["NONE", false], [undefined, false]]) {
  assert.strictEqual(await gh.commenterTrusted("acme/shop", { author_association: assoc }), ok, String(assoc));
}
assert.strictEqual(await load({ forgePermission: "write" }).commenterTrusted("forgejo~acme/shop", { user: { login: "dev" } }), true);
assert.strictEqual(await load({ forgePermission: "read" }).commenterTrusted("forgejo~acme/shop", { user: { login: "dev" } }), false);
assert.strictEqual(await load({ forgeStatus: 404 }).commenterTrusted("forgejo~acme/shop", { user: { login: "dev" } }), false);
assert.strictEqual(await load().commenterTrusted("forgejo~acme/shop", { user: { login: "../admin" } }), false, "login is validated before the API call");
await assert.rejects(load({ forgeStatus: 500 }).commenterTrusted("forgejo~acme/shop", { user: { login: "dev" } }));
ctx.diagnostic("owners, members and collaborators only");

// /review: forced re-review, then scores and review posted.
const r = load();
await r.runCommand("acme/shop", { id: 99, html_url: "https://github.com/acme/shop/pull/7#issuecomment-99" }, { cmd: "review", arg: "" });
assert.deepStrictEqual(r.calls[0], ["gh", "api", "--method", "POST", "repos/acme/shop/issues/comments/99/reactions", "-f", "content=eyes"]);
assert.deepStrictEqual(r.calls[1], ["score", "https://github.com/acme/shop/pull/7", true, "acme/shop"]);
assert.deepStrictEqual(r.calls[2][3], { postScores: true, postReview: true });
ctx.diagnostic("/review re-reviews and posts");

// Tools: run with the argument, then post as a comment.
const t = load();
await t.runCommand("forgejo~acme/shop", { id: 5, html_url: "https://git.example/acme/shop/pulls/12#issuecomment-5" }, { cmd: "ask", arg: "why?" });
assert.deepStrictEqual(t.calls[0], ["forge", "repos/forgejo~acme/shop/issues/comments/5/reactions", { content: "eyes" }]);
assert.deepStrictEqual(t.calls.slice(1).map((c) => [c[0], c[1], c[2], c[3]]), [
  ["tool", "https://git.example/acme/shop/pulls/12", "ask", { question: "why?" }],
  ["tool", "https://git.example/acme/shop/pulls/12", "ask", { action: "comment" }],
]);
ctx.diagnostic("tools run, then post");

// Failures are reported on the PR and rethrown for the log.
const f = load({ toolFails: true });
await assert.rejects(f.runCommand("acme/shop", { id: 1, html_url: "https://github.com/acme/shop/pull/7#x" }, { cmd: "improve", arg: "" }), /model said no/);
assert.deepStrictEqual(f.calls.at(-1), ["comment", "https://github.com/acme/shop/pull/7", 7, "🦦 CodeOtter `/improve` failed: model said no"]);
ctx.diagnostic("failures are replied to");

// Comment listing goes to the right API with an encoded timestamp.
const l = load();
await l.commentsSince("acme/shop", "2026-10-04T10:00:00.000Z");
await l.commentsSince("forgejo~acme/shop", "2026-10-04T10:00:00.000Z");
assert.strictEqual(l.calls[0][2], "repos/acme/shop/issues/comments?since=2026-10-04T10%3A00%3A00.000Z&sort=created&direction=asc&per_page=100");
assert.strictEqual(l.calls[1][1], "repos/forgejo~acme/shop/issues/comments?since=2026-10-04T10%3A00%3A00.000Z&limit=50");
ctx.diagnostic("comments listed since the last poll");

});
