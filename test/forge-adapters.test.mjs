// Git server adapters (core/forges.mjs) for Bitbucket Cloud, Bitbucket Data Center and Azure DevOps: what each sends,
// where, with which credentials, and what it makes of the answers. fetch is stubbed; nothing leaves the machine.
import assert from "node:assert/strict";
import { test } from "node:test";
import { makeForge, diffLines, fileDiff, diffStats, secretMatches } from "../core/forges.mjs";

test("git server adapters", async (ctx) => {
  const realFetch = globalThis.fetch;
  let routes = [];
  let sent = [];
  // routes: [method, url-prefix-or-regex, reply(url, body) -> Response | object]
  globalThis.fetch = async (url, init = {}) => {
    const method = init.method || "GET";
    const body = init.body ? JSON.parse(init.body) : undefined;
    sent.push({ method, url: String(url), auth: init.headers?.authorization, redirect: init.redirect, body });
    const hit = routes.find(([m, u]) => m === method && (u instanceof RegExp ? u.test(url) : String(url).startsWith(u)));
    if (!hit) return new Response("not found", { status: 404 });
    const out = await hit[2](String(url), body);
    return out instanceof Response ? out : Response.json(out);
  };
  const reset = (r) => { routes = r; sent = []; };
  try {
    // ---------------------------------------------------------------------------------------------------------------
    // diff helpers
    {
      const ops = diffLines(["a", "b", "c"], ["a", "x", "c", "d"]);
      assert.deepEqual(ops, [["=", "a"], ["-", "b"], ["+", "x"], ["=", "c"], ["+", "d"]]);
      const d = fileDiff({ oldPath: "src/a.js", newPath: "src/a.js", oldText: "a\nb\nc\n", newText: "a\nx\nc\nd\n" });
      assert.equal(d, "diff --git a/src/a.js b/src/a.js\n--- a/src/a.js\n+++ b/src/a.js\n@@ -1,3 +1,4 @@\n a\n-b\n+x\n c\n+d");
      assert.match(fileDiff({ oldPath: "", newPath: "new.txt", oldText: null, newText: "hi\n" }), /new file mode 100644\n--- \/dev\/null\n\+\+\+ b\/new.txt\n@@ -0,0 \+1,1 @@\n\+hi/);
      assert.match(fileDiff({ oldPath: "gone.txt", newPath: "", oldText: "x\n", newText: null }), /deleted file mode 100644\n--- a\/gone.txt\n\+\+\+ \/dev\/null\n@@ -1,1 \+0,0 @@\n-x/);
      assert.match(fileDiff({ oldPath: "a.png", newPath: "a.png", oldText: "", newText: "", binary: true }), /Binary files a\/a.png and b\/a.png differ/);
      assert.deepEqual(diffStats(d), [{ path: "src/a.js", additions: 2, deletions: 1 }]);
      for (let t = 0; t < 500; t++) {
        const r = () => Array.from({ length: Math.floor(Math.random() * 20) }, () => "abc"[Math.floor(Math.random() * 3)]);
        const a = r(), b = r(), o = diffLines(a, b);
        assert.deepEqual(o.filter((x) => x[0] !== "+").map((x) => x[1]), a);
        assert.deepEqual(o.filter((x) => x[0] !== "-").map((x) => x[1]), b);
      }
      assert.ok(secretMatches("s3cret", "s3cret") && !secretMatches("s3cret", "s3cre") && !secretMatches("", "") && !secretMatches("s", undefined));
      ctx.diagnostic("line diff, unified sections, stats and the shared-secret compare");
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Bitbucket Cloud
    {
      const f = { kind: "bitbucket", label: "Bitbucket", fixed: true, url: "https://bitbucket.org", token: "tok", user: "me@example.com" };
      const bb = makeForge("bitbucket", f);
      const repoRef = { full_name: "team/app", links: { html: { href: "https://bitbucket.org/team/app" } } };
      const fork = { full_name: "dev/app", links: { html: { href: "https://bitbucket.org/dev/app" } } };
      const API = "https://api.bitbucket.org/2.0/repositories/team/app";
      reset([
        ["GET", `${API}/pullrequests/5/diffstat?page=2`, () => ({ values: [{ old: { path: "old.js" }, lines_added: 0, lines_removed: 4 }] })],
        ["GET", `${API}/pullrequests/5/diffstat`, () => ({ values: [{ new: { path: "src/a.js" }, lines_added: 3, lines_removed: 1 }], next: "https://api.bitbucket.org/2.0/repositories/team/app/pullrequests/5/diffstat?page=2" })],
        ["GET", `${API}/pullrequests/5/commits`, () => ({ values: [{ hash: "b".repeat(40), message: "second\n\nbody", author: { user: { nickname: "dev" } }, date: "2026-11-02" }, { hash: "a".repeat(40), message: "first", author: { raw: "Dev <d@x>" } }] })],
        ["GET", `${API}/pullrequests/5/diff`, () => new Response(null, { status: 302, headers: { location: "https://api.bitbucket.org/2.0/repositories/team/app/diff/dev/app:bbbbbbbbbbbb%0Dccc?from_pullrequest_id=5" } })],
        ["GET", `${API}/diff/dev/app:`, () => new Response("diff --git a/src/a.js b/src/a.js\n")],
        ["GET", `${API}/pullrequests/5`, () => ({ id: 5, title: "Add cart", description: "Adds it", state: "OPEN", author: { nickname: "dev" }, updated_on: "2026-11-02T00:00:00Z", source: { branch: { name: "feat" }, commit: { hash: "bbbbbbbbbbbb" }, repository: fork }, destination: { branch: { name: "main" }, repository: repoRef } })],
      ]);
      const pr = await bb.pr("bitbucket~team/app", 5);
      assert.equal(pr.url, "https://bitbucket.org/team/app/pull-requests/5");
      assert.equal(pr.headRefOid, "b".repeat(40), "the full hash from the commit list, not the PR's 12 characters");
      assert.equal(pr.headRepo, "bitbucket~dev/app", "a fork's content is read from the fork");
      assert.deepEqual(pr.files, [{ path: "src/a.js", additions: 3, deletions: 1 }, { path: "old.js", additions: 0, deletions: 4 }]);
      assert.deepEqual([pr.additions, pr.deletions, pr.changedFiles], [3, 5, 2]);
      assert.deepEqual(pr.commits.map((c) => c.oid), ["a".repeat(40), "b".repeat(40)], "oldest first");
      assert.equal(pr.commits[0].authors[0].login, "Dev");
      assert.equal(pr.commits[1].messageBody, "body");
      assert.ok(sent.every((s) => s.auth === `Basic ${Buffer.from("me@example.com:tok").toString("base64")}` && s.url.startsWith("https://api.bitbucket.org/") && s.redirect === "manual"));
      assert.equal(await bb.diff("bitbucket~team/app", 5), "diff --git a/src/a.js b/src/a.js\n", "the diff redirect is followed on the API origin");
      // a PR's diffstat is documented as a redirect to the repository diffstat
      reset([
        ["GET", `${API}/pullrequests/6/diffstat`, () => new Response(null, { status: 302, headers: { location: `${API}/diffstat/dev/app:abc%0Dccc?from_pullrequest_id=6` } })],
        ["GET", `${API}/diffstat/dev/app:`, () => ({ values: [{ new: { path: "x.js" }, lines_added: 1, lines_removed: 0 }] })],
      ]);
      assert.deepEqual(await bb.list("repositories/team/app/pullrequests/6/diffstat"), [{ new: { path: "x.js" }, lines_added: 1, lines_removed: 0 }], "paged lists follow the diffstat redirect");
      reset([["GET", `${API}/pullrequests/5/diff`, () => new Response(null, { status: 302, headers: { location: "https://evil.example/steal" } })]]);
      await assert.rejects(bb.diff("bitbucket~team/app", 5), /failed \(302\)/);
      assert.equal(sent.length, 1, "a redirect off the API origin is refused, never followed");
      reset([["GET", `${API}/pullrequests/5`, () => new Response(null, { status: 302, headers: { location: `${API}/elsewhere` } })]]);
      await assert.rejects(bb.api("repositories/team/app/pullrequests/5"), /302/, "only the diff follows redirects");
      ctx.diagnostic("Bitbucket Cloud: PR, files, commits, fork head, diff redirect on the API origin only, Basic auth");

      f.user = "";
      const posted = [];
      reset([
        ["POST", `${API}/pullrequests/5/comments`, (u, b) => { posted.push(b); return b.inline?.to === 99 ? new Response("{}", { status: 400 }) : { id: posted.length }; }],
        ["GET", `${API}/pullrequests/5/comments`, () => ({ values: [{ id: 1, content: { raw: "<!-- codeotter:scores -->" }, user: { account_id: "me" } }, { id: 2, content: { raw: "inline" }, inline: { path: "a" } }, { id: 3, content: { raw: "reply" }, parent: { id: 1 } }] })],
        ["PUT", `${API}/pullrequests/5/comments/1`, (u, b) => b],
        ["POST", `${API}/commit/${"b".repeat(40)}/statuses/build`, (u, b) => b],
        ["GET", `${API}/permissions-config/users/acc-1`, () => ({ permission: "write" })],
        ["GET", `${API}/permissions-config/users/acc-2`, () => ({ permission: "read" })],
        ["GET", `${API}/permissions-config/users/acc-3`, () => new Response("{}", { status: 403 })],
      ]);
      const failed = await bb.inline("bitbucket~team/app", 5, [{ path: "src/a.js", line: 3, body: "fix" }, { path: "src/a.js", line: 99, body: "outside" }]);
      assert.deepEqual(failed.map((c) => c.line), [99], "only the comment the server could not anchor falls back");
      assert.deepEqual(posted[0], { content: { raw: "fix" }, inline: { path: "src/a.js", to: 3 } });
      assert.ok(sent.every((s) => s.auth === "Bearer tok"), "an access token without an email is a Bearer token");
      assert.deepEqual((await bb.comments("bitbucket~team/app", 5)).map((c) => [c.id, c.prNumber, c.user.id]), [[1, 5, "me"]], "top-level comments only");
      await bb.editComment("bitbucket~team/app", 5, 1, "new");
      assert.deepEqual(sent.at(-1).body, { content: { raw: "new" } });
      await bb.status("bitbucket~team/app", "b".repeat(40), { state: "failure", context: "codeotter/triage", description: "risk 80", target_url: "https://otter/x" });
      assert.deepEqual(sent.at(-1).body, { key: "codeotter-triage", name: "codeotter/triage", state: "FAILED", description: "risk 80", url: "https://otter/x" });
      assert.equal(await bb.trusted("bitbucket~team/app", { user: { id: "acc-1" } }), true);
      assert.equal(await bb.trusted("bitbucket~team/app", { user: { id: "acc-2" } }), false);
      assert.equal(await bb.trusted("bitbucket~team/app", { user: { id: "acc-3" } }), false, "no admin token, nobody trusted");
      assert.equal(await bb.trusted("bitbucket~team/app", { user: { id: "../x" } }), false);
      ctx.diagnostic("Bitbucket Cloud: inline comments one by one, marker comments, build statuses, write access for commands");

      const hooks = [];
      reset([
        ["GET", `${API}/hooks`, () => ({ values: hooks })],
        ["POST", `${API}/hooks`, (u, b) => { hooks.push({ ...b, uuid: "{0b0e0c0a-0000-4000-8000-000000000001}" }); return hooks.at(-1); }],
        ["DELETE", `${API}/hooks/`, () => { hooks.splice(0); return new Response(null, { status: 204 }); }],
      ]);
      assert.equal(await bb.ensureHook("bitbucket~team/app", "https://otter/webhooks/bitbucket", "sek"), true);
      assert.equal(await bb.ensureHook("bitbucket~team/app", "https://otter/webhooks/bitbucket", "sek"), false);
      assert.deepEqual(hooks[0].events, ["pullrequest:created", "pullrequest:updated", "pullrequest:push", "pullrequest:comment_created"]);
      assert.equal(hooks[0].secret, "sek");
      await bb.removeHook("bitbucket~team/app", "https://otter/webhooks/bitbucket");
      assert.equal(hooks.length, 0);
      assert.equal(sent.at(-1).url, `${API}/hooks/%7B0b0e0c0a-0000-4000-8000-000000000001%7D`);
      ctx.diagnostic("Bitbucket Cloud: repository webhook added once with its secret, removed by uuid");
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Bitbucket Data Center
    {
      const f = { kind: "bitbucketdc", label: "Bitbucket Data Center", url: "https://bb.corp", token: "dc" };
      const dc = makeForge("bitbucketdc", f);
      const API = "https://bb.corp/rest/api/latest/projects/PROJ/repos/app";
      const jsonDiff = { diffs: [{ source: { toString: "src/a.js" }, destination: { toString: "src/a.js" }, hunks: [{ sourceLine: 1, sourceSpan: 2, destinationLine: 1, destinationSpan: 2, segments: [{ type: "CONTEXT", lines: [{ line: "a" }] }, { type: "REMOVED", lines: [{ line: "b" }] }, { type: "ADDED", lines: [{ line: "x" }] }] }] }, { source: null, destination: { toString: "img.png" }, binary: true }] };
      reset([
        ["GET", `${API}/pull-requests/9/diff`, () => jsonDiff],
        ["GET", `${API}/pull-requests/9/commits`, () => ({ values: [{ id: "d".repeat(40), message: "two", author: { slug: "dev" }, authorTimestamp: 1762000000000 }, { id: "c".repeat(40), message: "one", author: { name: "dev" } }], isLastPage: true })],
        ["GET", `${API}/pull-requests/9`, () => ({ id: 9, title: "T", description: "D", state: "OPEN", version: 3, author: { user: { slug: "dev" } }, updatedDate: 1762000000000, fromRef: { displayId: "feat", latestCommit: "d".repeat(40), repository: { slug: "app", project: { key: "PROJ" } } }, toRef: { displayId: "main", repository: { slug: "app", project: { key: "PROJ" } } } })],
      ]);
      const pr = await dc.pr("bitbucketdc~PROJ/app", 9);
      assert.equal(pr.url, "https://bb.corp/projects/PROJ/repos/app/pull-requests/9");
      assert.equal(pr.headRepo, "bitbucketdc~PROJ/app");
      assert.deepEqual(pr.files, [{ path: "src/a.js", additions: 1, deletions: 1 }, { path: "img.png", additions: 0, deletions: 0 }]);
      assert.deepEqual(pr.commits.map((c) => c.oid), ["c".repeat(40), "d".repeat(40)]);
      assert.equal(await dc.diff("bitbucketdc~PROJ/app", 9), "diff --git a/src/a.js b/src/a.js\n--- a/src/a.js\n+++ b/src/a.js\n@@ -1,2 +1,2 @@\n a\n-b\n+x\ndiff --git a/img.png b/img.png\nnew file mode 100644\nBinary files /dev/null and b/img.png differ");
      assert.ok(sent.every((s) => s.auth === "Bearer dc" && s.url.startsWith("https://bb.corp/rest/")));
      ctx.diagnostic("Bitbucket Data Center: PR, commits oldest first, JSON diff to unified text, file stats from it");

      const tries = [];
      reset([
        ["POST", `${API}/pull-requests/9/comments`, (u, b) => { tries.push(b.anchor?.lineType || "none"); return b.anchor?.line === 50 || b.anchor?.lineType === "ADDED" && b.anchor?.line === 7 ? new Response("{}", { status: 409 }) : { id: 1 }; }],
        ["GET", `${API}/pull-requests/9/comments/4`, () => ({ id: 4, version: 6 })],
        ["PUT", `${API}/pull-requests/9/comments/4`, (u, b) => b],
        ["GET", `${API}/pull-requests/9`, () => ({ id: 9, title: "T", version: 3 })],
        ["PUT", `${API}/pull-requests/9`, (u, b) => b],
        ["POST", "https://bb.corp/rest/build-status/1.0/commits/", (u, b) => b],
        ["GET", `${API}/permissions/users?filter=lead`, () => ({ values: [{ user: { slug: "lead" }, permission: "REPO_WRITE" }], isLastPage: true })],
        ["GET", `${API}/permissions/users?filter=reader`, () => ({ values: [{ user: { slug: "reader" }, permission: "REPO_READ" }], isLastPage: true })],
        ["GET", "https://bb.corp/rest/api/latest/projects/PROJ/permissions/users?filter=reader", () => ({ values: [], isLastPage: true })],
        ["GET", "https://bb.corp/rest/api/latest/projects/PROJ/permissions/users?filter=pm", () => ({ values: [{ user: { slug: "pm" }, permission: "PROJECT_ADMIN" }], isLastPage: true })],
      ]);
      const failed = await dc.inline("bitbucketdc~PROJ/app", 9, [{ path: "a", line: 7, body: "x" }, { path: "a", line: 50, body: "y" }]);
      assert.deepEqual(tries, ["ADDED", "CONTEXT", "ADDED", "CONTEXT"], "an added line, then a context line");
      assert.deepEqual(failed.map((c) => c.line), [50]);
      await dc.editComment("bitbucketdc~PROJ/app", 9, 4, "new");
      assert.deepEqual(sent.at(-1).body, { text: "new", version: 6 }, "edits carry the comment's version");
      await dc.setBody("bitbucketdc~PROJ/app", 9, "desc");
      assert.deepEqual(sent.at(-1).body, { version: 3, title: "T", description: "desc" });
      await dc.status("bitbucketdc~PROJ/app", "d".repeat(40), { state: "success", context: "codeotter/triage", description: "ok", target_url: "https://otter/x" });
      assert.equal(sent.at(-1).url, `https://bb.corp/rest/build-status/1.0/commits/${"d".repeat(40)}`);
      assert.equal(sent.at(-1).body.state, "SUCCESSFUL");
      assert.equal(await dc.trusted("bitbucketdc~PROJ/app", { user: { login: "lead" } }), true);
      assert.equal(await dc.trusted("bitbucketdc~PROJ/app", { user: { login: "reader" } }), false);
      assert.equal(await dc.trusted("bitbucketdc~PROJ/app", { user: { login: "pm" } }), true, "a project grant counts");
      assert.equal(await dc.trusted("bitbucketdc~PROJ/app", { user: { login: "a b" } }), false);
      assert.equal(await dc.issue("bitbucketdc~PROJ/app", 3), null, "issues live in Jira");
      ctx.diagnostic("Bitbucket Data Center: anchored comments, versioned edits, build status, direct grants for commands");

      const hooks = [];
      reset([
        ["GET", `${API}/webhooks`, () => ({ values: hooks, isLastPage: true })],
        ["POST", `${API}/webhooks`, (u, b) => { hooks.push({ ...b, id: 12 }); return hooks.at(-1); }],
        ["DELETE", `${API}/webhooks/12`, () => { hooks.splice(0); return new Response(null, { status: 204 }); }],
      ]);
      assert.equal(await dc.ensureHook("bitbucketdc~PROJ/app", "https://otter/webhooks/bitbucketdc", "sek"), true);
      assert.equal(await dc.ensureHook("bitbucketdc~PROJ/app", "https://otter/webhooks/bitbucketdc", "sek"), false);
      assert.deepEqual(hooks[0].configuration, { secret: "sek" });
      await dc.removeHook("bitbucketdc~PROJ/app", "https://otter/webhooks/bitbucketdc");
      assert.equal(hooks.length, 0);
      const r = dc.route("pr:comment:added", { pullRequest: { id: 9, state: "OPEN", toRef: { repository: { slug: "app", project: { key: "PROJ" } } } }, comment: { id: 40, text: "/review", author: { slug: "lead" }, createdDate: 1762000000000 } });
      assert.deepEqual([r.repo, r.comment.id, r.comment.prNumber, r.comment.user.login], ["bitbucketdc~PROJ/app", 40, 9, "lead"]);
      assert.equal(dc.route("pr:comment:added", { pullRequest: { id: 9 }, comment: { id: 1 }, commentParentId: 3 })?.comment, undefined, "replies are not commands");
      ctx.diagnostic("Bitbucket Data Center: webhook added once, removed by id; comment events routed");
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Azure DevOps
    {
      const f = { kind: "azure", label: "Azure DevOps", fixed: true, url: "https://dev.azure.com", token: "pat", orgs: ["contoso"] };
      const az = makeForge("azure", f);
      const G = "https://dev.azure.com/contoso/Web%20Shop/_apis/git/repositories/api";
      const oldBlob = "1".repeat(40), newBlob = "2".repeat(40), addBlob = "3".repeat(40);
      let blobReads = 0;
      reset([
        ["GET", `${G}/pullrequests/31?`, () => ({ pullRequestId: 31, title: "Fix tax", description: "D", status: "active", isDraft: false, createdBy: { uniqueName: "dev@contoso.com" }, creationDate: "2026-11-01T00:00:00Z", sourceRefName: "refs/heads/fix", targetRefName: "refs/heads/main", lastMergeSourceCommit: { commitId: "e".repeat(40) }, labels: [{ name: "bug", active: true }, { name: "old", active: false }] })],
        ["GET", `${G}/pullRequests/31/iterations?`, () => ({ value: [{ id: 1 }, { id: 2, sourceRefCommit: { commitId: "e".repeat(40) } }] })],
        ["GET", `${G}/pullRequests/31/iterations/2/changes?`, () => ({ changeEntries: [
          { changeType: "edit", item: { path: "/src/tax.js", objectId: newBlob, originalObjectId: oldBlob } },
          { changeType: "add", item: { path: "/src/new.js", objectId: addBlob } },
          { changeType: "edit", item: { path: "/src", isFolder: true } },
        ] })],
        ["GET", `${G}/pullRequests/31/commits?`, () => ({ value: [{ commitId: "e".repeat(40), comment: "fix tax", author: { name: "Dev", date: "2026-11-01" } }, { commitId: "d".repeat(40), comment: "start" }] })],
        ["GET", `${G}/blobs/${oldBlob}`, () => { blobReads++; return new Response("rate = 0.1\ntotal\n"); }],
        ["GET", `${G}/blobs/${newBlob}`, () => { blobReads++; return new Response("rate = 0.15\ntotal\n"); }],
        ["GET", `${G}/blobs/${addBlob}`, () => { blobReads++; return new Response("export {};\n"); }],
      ]);
      const pr = await az.pr("azure~contoso/Web Shop/api", 31);
      assert.equal(pr.url, "https://dev.azure.com/contoso/Web%20Shop/_git/api/pullrequest/31");
      assert.deepEqual([pr.baseRefName, pr.headRefName, pr.headRefOid, pr.author.login], ["main", "fix", "e".repeat(40), "dev@contoso.com"]);
      assert.deepEqual(pr.labels, [{ name: "bug" }]);
      assert.deepEqual(pr.files, [{ path: "src/tax.js", additions: 1, deletions: 1 }, { path: "src/new.js", additions: 1, deletions: 0 }]);
      assert.deepEqual(pr.commits.map((c) => c.oid), ["d".repeat(40), "e".repeat(40)]);
      const diff = await az.diff("azure~contoso/Web Shop/api", 31);
      assert.equal(diff, "diff --git a/src/tax.js b/src/tax.js\n--- a/src/tax.js\n+++ b/src/tax.js\n@@ -1,2 +1,2 @@\n-rate = 0.1\n+rate = 0.15\n total\ndiff --git a/src/new.js b/src/new.js\nnew file mode 100644\n--- /dev/null\n+++ b/src/new.js\n@@ -0,0 +1,1 @@\n+export {};");
      assert.equal(blobReads, 3, "the diff the review asks for after the PR is built once per head");
      assert.ok(sent.every((s) => s.auth === `Basic ${Buffer.from(":pat").toString("base64")}` && s.url.startsWith("https://dev.azure.com/contoso/") && /api-version=7\.1/.test(s.url)));
      ctx.diagnostic("Azure DevOps: PR from its last iteration, unified diff built from blobs (once per head), PAT auth, api-version");

      reset([
        ["GET", `${G}/pullRequests/31/iterations?`, () => ({ value: [{ id: 4 }] })],
        ["POST", `${G}/pullRequests/31/statuses?`, (u, b) => b],
        ["POST", `${G}/pullRequests/31/threads?`, (u, b) => (b.threadContext?.rightFileEnd.line === 99 ? new Response("{}", { status: 400 }) : { id: 70 })],
        ["GET", `${G}/pullRequests/31/threads?`, () => ({ value: [
          { id: 70, comments: [{ id: 1, content: "<!-- codeotter:scores -->", author: { id: "me" } }] },
          { id: 71, threadContext: { filePath: "/a" }, comments: [{ id: 1, content: "inline" }] },
          { id: 72, comments: [{ id: 1, content: "Policy", commentType: "system" }] },
        ] })],
        ["PATCH", `${G}/pullRequests/31/threads/70/comments/1?`, (u, b) => b],
        ["GET", "https://dev.azure.com/contoso/_apis/projects/Web%20Shop?", () => ({ visibility: "private" })],
        ["GET", "https://dev.azure.com/contoso/_apis/wit/workitems/12?", () => new Response("{}", { status: 404 })],
        ["GET", "https://dev.azure.com/contoso/Web%20Shop/_apis/wit/workitems/7?", () => ({ id: 7, fields: { "System.Title": "Tax", "System.Description": "<div>Rate&nbsp;is <b>wrong</b></div>", "System.State": "Active", "System.Tags": "billing; urgent" } })],
      ]);
      await az.status("azure~contoso/Web Shop/api", "e".repeat(40), { state: "pending", context: "codeotter/triage", description: "running", target_url: "https://otter/x" }, 31);
      assert.deepEqual(sent.at(-1).body, { state: "pending", description: "running", targetUrl: "https://otter/x", context: { genre: "codeotter", name: "triage" }, iterationId: 4 }, "a PR status on the current iteration");
      const failed = await az.inline("azure~contoso/Web Shop/api", 31, [{ path: "src/tax.js", line: 4, startLine: 2, body: "fix" }, { path: "src/tax.js", line: 99, body: "x" }]);
      assert.deepEqual(failed.map((c) => c.line), [99]);
      assert.deepEqual(sent.find((s) => s.method === "POST" && s.url.includes("/threads")).body.threadContext, { filePath: "/src/tax.js", rightFileStart: { line: 2, offset: 1 }, rightFileEnd: { line: 4, offset: 1 } }, "a line range");
      assert.equal(az.multiLineSuggestions, true);
      assert.deepEqual((await az.comments("azure~contoso/Web Shop/api", 31)).map((c) => [c.id, c.user.id]), [["70:1", "me"]], "top-level, non-system threads");
      await az.editComment("azure~contoso/Web Shop/api", 31, "70:1", "new");
      assert.deepEqual(sent.at(-1).body, { content: "new" });
      assert.throws(() => az.editComment("azure~contoso/Web Shop/api", 31, "x", "new"), /Invalid Azure DevOps comment id/);
      await assert.rejects(az.setBody("azure~contoso/Web Shop/api", 31, "x".repeat(4001)), /4000 characters/);
      assert.equal(await az.trusted("azure~contoso/Web Shop/api", {}), true, "private project: only members can comment");
      const wi = await az.issue("azure~contoso/Web Shop/api", 7);
      assert.deepEqual([wi.title, wi.body, wi.state, wi.labels, wi.url], ["Tax", "Rate is wrong", "Active", ["billing", "urgent"], "https://dev.azure.com/contoso/Web%20Shop/_workitems/edit/7"]);
      ctx.diagnostic("Azure DevOps: PR status on the iteration, ranged inline threads, thread ids, 4000-char limit, work items");

      reset([["GET", "https://dev.azure.com/contoso/_apis/projects/Web%20Shop?", () => ({ visibility: "public" })]]);
      assert.equal(await az.trusted("azure~contoso/Web Shop/api", {}), false, "public projects take commands from nobody");

      const subs = [];
      reset([
        ["GET", `${G}?`, () => ({ id: "11111111-1111-4111-8111-111111111111", project: { id: "22222222-2222-4222-8222-222222222222" } })],
        ["GET", "https://dev.azure.com/contoso/_apis/hooks/subscriptions?", () => ({ value: subs })],
        ["POST", "https://dev.azure.com/contoso/_apis/hooks/subscriptions?", (u, b) => { subs.push({ ...b, id: `33333333-3333-4333-8333-00000000000${subs.length}` }); return subs.at(-1); }],
        ["DELETE", "https://dev.azure.com/contoso/_apis/hooks/subscriptions/", (u) => { subs.splice(subs.findIndex((s) => u.includes(s.id)), 1); return new Response(null, { status: 204 }); }],
      ]);
      assert.equal(await az.ensureHook("azure~contoso/Web Shop/api", "https://otter/webhooks/azure", "sek"), true);
      assert.equal(await az.ensureHook("azure~contoso/Web Shop/api", "https://otter/webhooks/azure", "sek"), false);
      assert.deepEqual(subs.map((s) => s.eventType), ["git.pullrequest.created", "git.pullrequest.updated", "ms.vss-code.git-pullrequest-comment-event"]);
      assert.equal(subs[0].consumerInputs.httpHeaders, "X-CodeOtter-Secret:sek");
      assert.deepEqual(subs.map((s) => s.resourceVersion), ["1.0", "1.0", "1.0-preview.1"], "the comment event only has a preview resource version");
      assert.deepEqual(subs[0].publisherInputs, { projectId: "22222222-2222-4222-8222-222222222222", repository: "11111111-1111-4111-8111-111111111111" });
      await az.removeHook("azure~contoso/Web Shop/api", "https://otter/webhooks/azure");
      assert.equal(subs.length, 0);
      ctx.diagnostic("Azure DevOps: one service hook subscription per event, the secret as a header, all removed with the repository");

      reset([["GET", "https://dev.azure.com/contoso/_apis/git/repositories?", () => ({ value: [{ name: "api", project: { name: "Web Shop" } }, { name: "old", isDisabled: true, project: { name: "Web Shop" } }, { name: "bad/name", project: { name: "Web Shop" } }] })]]);
      assert.deepEqual(await az.listRepos(), ["azure~contoso/Web Shop/api"]);
      // an expired PAT gets 203 and a sign-in page, not a 401
      reset([["GET", "https://dev.azure.com/contoso/_apis/projects?", () => new Response("<html>sign in</html>", { status: 203, headers: { "content-type": "text/html" } })]]);
      await assert.rejects(az.test(), (e) => e.status === 401 && /failed \(401\)/.test(e.message));
      // payloads without webUrl: remoteUrl, including the older visualstudio.com host
      const pr0 = { pullRequestId: 8, status: "active", lastMergeSourceCommit: { commitId: "a".repeat(40) } };
      assert.equal(az.route("git.pullrequest.created", { resource: { ...pr0, repository: { remoteUrl: "https://contoso@dev.azure.com/contoso/Web%20Shop/_git/api" } } }).repo, "azure~contoso/Web Shop/api");
      assert.equal(az.route("git.pullrequest.created", { resource: { ...pr0, repository: { remoteUrl: "https://contoso.visualstudio.com/DefaultCollection/Web%20Shop/_git/api" } } }).repo, "azure~contoso/Web Shop/api");
      assert.equal(az.route("git.pullrequest.created", { resource: { ...pr0, repository: { remoteUrl: "https://evil.example/contoso/p/_git/api" } } }), null);
      f.token = "";
      await assert.rejects(az.listRepos(), /Configure an access token/);
      ctx.diagnostic("Azure DevOps: repositories listed per configured organization; nothing is sent without a token");
    }
  } finally {
    globalThis.fetch = realFetch;
  }
});
