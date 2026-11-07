// The single pull request queue, catch-up poll, webhooks, the local forwarder and forge hooks.
import { spawn } from "node:child_process";
import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { secretMatches } from "./forges.mjs";
import { APP_URL, FORGE_API, FORGES, IS_SERVER, PORT, REPO_RE } from "./config.mjs";
import { store } from "./store.mjs";
import { createGitHubAppJwt, forgeId, forgeOf, forgetGithubRepos, ghEnv, isForgeRepo, nativeRepo, normalizeForgePr, openPrs, repos } from "./git.mjs";
import { reviewConfig } from "./context.mjs";
import { score, SHA_RE, syncPrComments, triageConfig, triagePr } from "./review.mjs";
import { commenterTrusted, commentPrNumber, oneLine, parseCommand, runCommand } from "./pr-tools.mjs";
import { repoOf } from "./views.mjs";

// <pr-events>
// One queue for every trigger. The catch-up poll, the webhooks and the local forwarder all call enqueuePr(); work is keyed by
// PR URL, de-duplicated by head SHA, reviews run one at a time outside the poll, and a failed review is retried (three
// tries, ten minutes apart) with its error kept, instead of hammering the model every poll.
const PR_QUEUE = new Map(); // url -> { repo, p }
let prDraining = false;
const MAX_REVIEW_TRIES = 3;
const RETRY_AFTER = 10 * 60e3;
const skipReview = (p) => !!p.isDraft || (p.labels || []).some((l) => (l?.name || l) === "codeotter:skip");
function enqueuePr(repo, p) {
  if (!p?.url || !SHA_RE.test(p.headRefOid || "")) return false;
  PR_QUEUE.set(p.url, { repo, p });
  drainPrQueue();
  return true;
}
async function drainPrQueue() {
  if (prDraining) return;
  prDraining = true;
  try {
    while (PR_QUEUE.size) {
      const [url, { repo, p }] = PR_QUEUE.entries().next().value;
      PR_QUEUE.delete(url);
      await handlePr(repo, p).catch((e) => console.warn(`[pr-events] ${url}: ${e.message}`));
    }
  } finally {
    prDraining = false;
  }
}
async function handlePr(repo, p) {
  const [tc, rc] = await Promise.all([triageConfig(), reviewConfig(repo)]);
  const done = (await store.getSetting("triageResults")) || {};
  if (tc.auto && done[p.url]?.headSha !== p.headRefOid) await triagePr(p.url, repo).catch((e) => console.warn(`[triage] ${p.url}: ${e.message}`));
  if (!rc.auto || skipReview(p)) return;
  const reviewed = (await store.getSetting("autoReviewed")) || {};
  if (reviewed[p.url] === p.headRefOid) return;
  const failed = (await store.getSetting("autoReviewFailed")) || {};
  const f = failed[p.url];
  if (f && f.sha === p.headRefOid && (f.tries >= MAX_REVIEW_TRIES || Date.now() - f.at < RETRY_AFTER)) return;
  try {
    await syncPrComments(await score(p.url, true, repo), repo, { postScores: true, postReview: true });
    // recorded on success only: a failed review (model down, rate limit) is retried, see above
    reviewed[p.url] = p.headRefOid;
    delete failed[p.url];
  } catch (e) {
    failed[p.url] = { sha: p.headRefOid, at: Date.now(), tries: f?.sha === p.headRefOid ? f.tries + 1 : 1, error: oneLine(e.message, 300) };
    console.warn(`[auto-review] ${p.url} (try ${failed[p.url].tries}/${MAX_REVIEW_TRIES}): ${e.message}`);
  }
  await Promise.all([store.setSetting("autoReviewed", reviewed), store.setSetting("autoReviewFailed", failed)]);
}
// Catch-up poll: every two minutes for a forge without a recent webhook delivery, every fifteen minutes once it has one.
// It lists open pull requests and enqueues them; it never reviews inline, so a long review cannot delay another repository.
export const CATCH_UP_EVERY = 15 * 60e3;
export const lastCatchUp = {};
const pollDue = (src) => !webhookHealthy(src) || Date.now() - (lastCatchUp[src] || 0) >= CATCH_UP_EVERY;
let triagePolling = false;
if (IS_SERVER) setInterval(async () => {
  if (triagePolling) return;
  triagePolling = true;
  try {
    const tc = await triageConfig();
    const all = await repos();
    const configs = new Map(await Promise.all(all.map(async (r) => [r, await reviewConfig(r)])));
    const anyAuto = [...configs.values()].some((c) => c.auto);
    if (!tc.auto && !anyAuto) return;
    const open = new Set();
    const due = new Set();
    let listedAll = true;
    for (const repo of all) {
      const src = forgeId(repo) || "github";
      if (!tc.auto && !configs.get(repo).auto) continue;
      if (!pollDue(src)) { listedAll = false; continue; }
      due.add(src);
      // One unreachable forge or repository must not stop the others from being triaged and reviewed.
      let prs;
      try {
        prs = await openPrs(repo, { strict: true });
      } catch (e) {
        listedAll = false;
        console.warn(`[poll] ${repo}: ${e.message}`);
        continue;
      }
      for (const p of prs) {
        open.add(p.url);
        enqueuePr(repo, p);
      }
    }
    for (const src of due) lastCatchUp[src] = Date.now();
    // Closed PRs leave the records; unpruned they grow until the settings row hits its size limit and every save fails.
    // Only repositories listed this round can prove a PR closed; a repository skipped here keeps its entries.
    if (listedAll && anyAuto) {
      const skipped = new Set(all.filter((r) => !tc.auto && !configs.get(r).auto));
      for (const key of ["autoReviewed", "autoReviewFailed"]) {
        const rec = (await store.getSetting(key)) || {};
        const stale = Object.keys(rec).filter((u) => !open.has(u) && !PR_QUEUE.has(u) && !skipped.has(repoOf({ url: u })));
        if (stale.length) { for (const u of stale) delete rec[u]; await store.setSetting(key, rec); }
      }
    }
  } catch (e) {
    console.warn(`[poll] ${e.message}`);
  } finally {
    triagePolling = false;
  }
}, 120e3).unref();
// </pr-events>

// <webhooks>
// GitHub App and git server webhooks land on POST /webhooks/<source>. The raw body is HMAC-SHA256 checked against the
// stored secret (Azure DevOps cannot sign: its deliveries carry the secret in a header, compared in constant time),
// deliveries are de-duplicated by id, the response goes out before any work starts, and the work goes through the same
// queue as the poll. Nothing here trusts the payload beyond the repository name and PR number; score() re-reads the PR.
const WEBHOOK_LAST = {}; // source -> { at, event, delivery }
const SEEN_DELIVERIES = new Set();
export const HANDLED_COMMENTS = new Set();
export const remember = (set, key, max = 5000) => {
  if (set.has(key)) return false;
  set.add(key);
  if (set.size > max) set.delete(set.values().next().value);
  return true;
};
const WEBHOOK_HEALTHY_FOR = 10 * 60e3;
export const webhookHealthy = (src) => Date.now() - (WEBHOOK_LAST[src]?.at || 0) < WEBHOOK_HEALTHY_FOR;
export const webhookUrl = (src) => `${APP_URL}/webhooks/${src}`;
export const LOCAL_APP_URL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(APP_URL);
export const describeDelivery = (src) => {
  const d = WEBHOOK_LAST[src];
  return d ? `${d.event || "event"} ${Math.round((Date.now() - d.at) / 60e3)} min ago` : "No delivery since start";
};
function verifySignature(secret, body, header) {
  if (!secret || !header) return false;
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const given = String(header).replace(/^sha256=/, "");
  return given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}
async function webhookSecrets(src) {
  if (src === "github") {
    const app = (await store.getSetting("githubApp")) || {};
    return [app.webhookSecret, app.forwardSecret].filter(Boolean);
  }
  return [(await store.getSetting(`${src}Webhook`))?.secret].filter(Boolean);
}
const readRaw = (req, max = 2e6) =>
  new Promise((ok, err) => {
    const parts = [];
    let n = 0;
    req.on("data", (d) => { n += d.length; if (n > max) { req.destroy(); err(new Error("Request body too large")); } parts.push(d); })
      .on("end", () => ok(Buffer.concat(parts)))
      .on("error", err);
  });
let webhookStatusWritten = 0;
function noteDelivery(src, event, delivery) {
  WEBHOOK_LAST[src] = { at: Date.now(), event, delivery };
  if (Date.now() - webhookStatusWritten < 5 * 60e3) return;
  webhookStatusWritten = Date.now();
  store.setSetting("webhookStatus", WEBHOOK_LAST).catch(() => {});
}
// GitHub's pull_request payload in the shape openPrs() returns, so the queue sees one kind of object.
const normalizeGitHubPr = (pr) => ({
  number: pr.number, title: pr.title || "", body: pr.body || "", url: pr.html_url,
  author: { login: pr.user?.login || "unknown" }, updatedAt: pr.updated_at,
  baseRefName: pr.base?.ref || "", headRefName: pr.head?.ref || "", headRefOid: pr.head?.sha || "",
  additions: pr.additions ?? 0, deletions: pr.deletions ?? 0, changedFiles: pr.changed_files ?? 0,
  isDraft: !!pr.draft, labels: (pr.labels || []).map((l) => ({ name: l?.name || String(l) })),
});
const PR_EVENT_ACTIONS = ["opened", "synchronize", "synchronized", "reopened", "ready_for_review"];
export async function handleWebhook(req, res, src) {
  const reply = (status, o) => { res.statusCode = status; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(o)); };
  if (src !== "github" && !FORGES[src]?.url) return reply(404, { error: `${FORGES[src]?.label || src} is not configured` });
  const body = await readRaw(req);
  const h = req.headers;
  const forge = src === "github" ? null : FORGE_API[src];
  let { event, delivery, signature } = forge ? forge.hookMeta(h) : { event: String(h["x-github-event"] || ""), delivery: String(h["x-github-delivery"] || ""), signature: h["x-hub-signature-256"] };
  const secrets = await webhookSecrets(src);
  if (!secrets.length) return reply(503, { error: `No ${src} webhook secret configured (Admin / Git providers)` });
  const ok = forge?.secretHeader ? secrets.some((s) => secretMatches(s, h[forge.secretHeader])) : secrets.some((s) => verifySignature(s, body, signature));
  if (!ok) return reply(401, { error: "Bad signature" });
  let payload;
  try {
    payload = JSON.parse(body.toString("utf8"));
  } catch {
    return reply(400, { error: "Bad JSON" });
  }
  if (forge?.hookBody) ({ event, delivery } = forge.hookBody(payload));
  noteDelivery(src, event, delivery);
  reply(202, { ok: true });
  if (delivery && !remember(SEEN_DELIVERIES, `${src}:${delivery}`)) return;
  routeWebhook(src, event, payload).catch((e) => console.warn(`[webhook ${src}] ${event}: ${e.message}`));
}
async function routeWebhook(src, event, x) {
  if (event === "ping") return;
  if (event === "installation" || event === "installation_repositories") { forgetGithubRepos(); return; }
  // Bitbucket and Azure DevOps payloads have their own shapes; their adapter turns them into a PR or a comment.
  const routed = FORGE_API[src]?.route?.(event, x);
  if (FORGE_API[src]?.route) {
    if (!routed || !REPO_RE.test(routed.repo) || !(await repos()).includes(routed.repo)) return;
    if (routed.pr) return enqueuePr(routed.repo, routed.pr);
    return routed.comment && handleComment(routed.repo, routed.comment);
  }
  const full = String(x?.repository?.full_name || "");
  if (!REPO_RE.test(full)) return;
  const repo = src === "github" ? full : `${src}~${full}`;
  if (!(await repos()).includes(repo)) return; // not onboarded here
  if (event === "pull_request") {
    if (!x.pull_request || !PR_EVENT_ACTIONS.includes(x.action)) return;
    enqueuePr(repo, src === "github" ? normalizeGitHubPr(x.pull_request) : normalizeForgePr(x.pull_request, repo));
    return;
  }
  if (event === "issue_comment" || event === "pull_request_comment") {
    const c = x.comment;
    if (x.action !== "created" || !c || !(x.issue?.pull_request || x.is_pull)) return;
    return handleComment(repo, c);
  }
}
// A comment command from a webhook: once per comment, only when commands are on and the commenter may write.
async function handleComment(repo, c) {
  if (!(await reviewConfig(repo)).commands) return;
  const command = parseCommand(c.body);
  if (!command || !commentPrNumber(c)) return;
  if (!remember(HANDLED_COMMENTS, `${repo}#${c.id}`)) return;
  // move the command poll's bookmark past this comment so it is not listed again
  const seen = (await store.getSetting("commandsSeen")) || {};
  const at = Date.parse(c.created_at || "");
  if (at && !(Date.parse(seen[repo] || "") >= at)) {
    seen[repo] = new Date(at).toISOString();
    await store.setSetting("commandsSeen", seen);
  }
  if (!(await commenterTrusted(repo, c).catch(() => false))) return;
  await runCommand(repo, c, command);
}
// GitHub does not retry a failed delivery on its own. After a restart, the pull_request deliveries that failed while this
// process was down are asked for again; comments are covered by the command poll's own "since" bookmark.
export async function redeliverGitHubFailures() {
  const app = await store.getSetting("githubApp");
  if (!app?.id || !app?.pem || !app?.webhookSecret) return;
  const since = (await store.getSetting("webhookStatus"))?.github?.at || Date.now() - 24 * 3600e3;
  const headers = { authorization: `Bearer ${createGitHubAppJwt(app.id, app.pem)}`, accept: "application/vnd.github+json", "user-agent": "CodeOtter" };
  const r = await fetch("https://api.github.com/app/hook/deliveries?per_page=100", { headers, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`deliveries ${r.status}`);
  const rows = (await r.json()).filter((d) => d.event === "pull_request" && !d.redelivery && Date.parse(d.delivered_at) > since && !(d.status_code >= 200 && d.status_code < 300));
  let n = 0;
  for (const d of rows) {
    const a = await fetch(`https://api.github.com/app/hook/deliveries/${encodeURIComponent(d.id)}/attempts`, { method: "POST", headers, signal: AbortSignal.timeout(10000) });
    if (a.ok) n++;
  }
  if (n) console.log(`[webhook github] asked GitHub to redeliver ${n} failed pull_request deliveries`);
}
// </webhooks>

// <forwarder>
// Local development: `gh webhook forward` (extension cli/gh-webhook) streams a repository's webhooks to this process, so a
// laptop without a public URL still gets pull_request and issue_comment events. These are repository webhooks signed with
// our own secret; GitHub calls the feature dev-only and allows one forwarder per repository. Admin / Git providers / GitHub.
const FORWARDERS = new Map(); // repo -> { proc, state, error, restarts }
export async function syncForwarders() {
  const want = (await store.getSetting("webhookForward")) && IS_SERVER ? (await repos()).filter((r) => !isForgeRepo(r)) : [];
  for (const [repo, f] of FORWARDERS) if (!want.includes(repo)) { FORWARDERS.delete(repo); f.proc?.kill(); }
  if (!want.length) return;
  const app = (await store.getSetting("githubApp")) || {};
  let secret = app.forwardSecret;
  if (!secret) {
    secret = randomBytes(24).toString("hex");
    await store.setSetting("githubApp", { ...app, forwardSecret: secret });
  }
  for (const repo of want) if (!FORWARDERS.has(repo)) startForwarder(repo, secret);
}
function startForwarder(repo, secret) {
  const f = { proc: null, state: "starting", error: "", restarts: 0 };
  FORWARDERS.set(repo, f);
  const run = () => {
    if (FORWARDERS.get(repo) !== f) return;
    const p = spawn("gh", ["webhook", "forward", `--repo=${repo}`, "--events=pull_request,issue_comment", `--url=http://localhost:${PORT}/webhooks/github`, `--secret=${secret}`], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, env: ghEnv() });
    f.proc = p;
    f.state = "running";
    let err = "";
    p.stderr.on("data", (d) => { err += d; });
    p.on("error", (e) => { f.state = "error"; f.error = e.message; });
    p.on("close", (code) => {
      if (FORWARDERS.get(repo) !== f) return;
      f.state = "error";
      f.error = /unknown command|not found/i.test(err) ? "Install the extension: gh extension install cli/gh-webhook" : oneLine(err, 200) || `gh exited ${code}`;
      if (!/Install the extension/.test(f.error) && f.restarts < 20) setTimeout(run, Math.min(60e3, 2000 * 2 ** f.restarts++)).unref();
    });
  };
  run();
}
export const forwarderStatus = () => [...FORWARDERS].map(([repo, f]) => `${repo}: ${f.state}${f.error ? ` (${f.error})` : ""}`).join(" · ") || "Off";
// </forwarder>

// <forge-hooks>
// Git servers have no app installs: a repository webhook (Azure DevOps: service hook subscriptions) is registered when a
// repository is onboarded and removed when it leaves. One secret per forge, generated once; the hook is recognised by its URL so it is never duplicated.
async function forgeHookSecret(src) {
  const cur = await store.getSetting(`${src}Webhook`);
  if (cur?.secret) return cur.secret;
  const secret = randomBytes(24).toString("hex");
  await store.setSetting(`${src}Webhook`, { ...(cur || {}), secret });
  return secret;
}
const ensureForgeHook = async (repo) => forgeOf(repo).ensureHook(repo, webhookUrl(forgeId(repo)), await forgeHookSecret(forgeId(repo)));
const removeForgeHook = (repo) => forgeOf(repo).removeHook(repo, webhookUrl(forgeId(repo))).catch(() => {});
// Called after the onboarded list changes: registers forge hooks for newcomers, drops them for leavers, re-syncs forwarders.
export async function reposChanged(before, after) {
  for (const repo of after.filter((r) => isForgeRepo(r) && !before.includes(r))) await ensureForgeHook(repo).catch((e) => console.warn(`[webhook ${forgeId(repo)}] ${nativeRepo(repo)}: ${e.message}`));
  for (const repo of before.filter((r) => isForgeRepo(r) && !after.includes(r))) await removeForgeHook(repo).catch(() => {});
  await syncForwarders().catch((e) => console.warn(`[forwarder] ${e.message}`));
}
// </forge-hooks>
