// pr-scorer: zero-dependency PR quality + blast-radius scorer. `node server.mjs` then open http://localhost:4747
import http from "node:http";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PORT = process.env.PORT || 4747;
// ponytail: default repo = the git repo you launch from; set REPO to point elsewhere
const REPO = process.env.REPO || repoFromCwd();
function repoFromCwd() {
  try {
    return execFileSync("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}
const MODEL = process.env.LLM_MODEL || "MiniMax-M3";
const BASE_URL = process.env.LLM_BASE_URL || "https://api.minimax.io/v1";
const API_KEY = process.env.LLM_API_KEY || piMinimaxKey();
const SCORES = join(import.meta.dirname, "scores");
mkdirSync(SCORES, { recursive: true });

// ponytail: reuse the pi CLI's MiniMax key so nothing needs configuring; set LLM_* env to point at Ollama or anything OpenAI-compatible
function piMinimaxKey() {
  try {
    return JSON.parse(readFileSync(join(homedir(), ".pi/agent/auth.json"), "utf8")).minimax.key;
  } catch {
    return "";
  }
}

const gh = (...args) => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 << 20 });

const HOTSPOTS = [
  ["migrations", /supabase\/migrations\//],
  ["auth / security", /auth|acl|permission|middleware|secret|token/i],
  ["payments / money", /payment|invoice|airwallex|stripe|fee/i],
  ["public API routes", /app\/api\//],
  ["core domain", /\bcore\//],
  ["dependencies", /package\.json|pnpm-lock\.yaml/],
  ["CI / deploy", /\.github\/|railway\.json|Dockerfile/],
];

function blastRadius(files) {
  const lines = files.reduce((n, f) => n + f.additions + f.deletions, 0);
  const dirs = new Set(files.map((f) => f.path.split("/").slice(0, 3).join("/")));
  const hot = HOTSPOTS.filter(([, re]) => files.some((f) => re.test(f.path))).map(([n]) => n);
  const tests = files.filter((f) => /test|spec|__tests__/.test(f.path)).length;
  // ponytail: additive heuristic; swap in real import-graph fan-out if this ever misleads
  const score = Math.min(100, Math.min(35, files.length * 3) + Math.min(30, lines / 25) + Math.min(35, hot.length * 12));
  return { score: Math.round(score), files: files.length, lines, dirs: dirs.size, hotspots: hot, testFiles: tests };
}

async function judge(pr, diff) {
  if (!API_KEY && !BASE_URL.includes("localhost")) throw new Error("No LLM key: set LLM_API_KEY or LLM_BASE_URL");
  const prompt = `You are a strict senior code reviewer. Review this pull request and reply with ONLY a JSON object:
{"summary":"2-3 sentence walkthrough","verdict":"approve|comment|request_changes",
 "scores":{"quality":0-100,"correctness_risk":0-100 (100 = very risky),"test_coverage":0-100,"readability":0-100,"pr_hygiene":0-100 (title, description, scope, commit focus)},
 "findings":[{"file":"path","severity":"high|medium|low|nit","title":"short","detail":"why + what to do"}],
 "walkthrough":[{"file":"path","change":"one line"}]}
Be concrete; cite files. Max 8 findings, most severe first. Today is ${new Date().toISOString().slice(0, 10)}.

PR #${pr.number}: ${pr.title}
Author: ${pr.author.login}  Base: ${pr.baseRefName}  Files: ${pr.changedFiles}  +${pr.additions} -${pr.deletions}
Description:
${(pr.body || "(none)").slice(0, 3000)}

Diff (may be truncated):
${diff.slice(0, 90000)}`;
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({ model: MODEL, temperature: 0.2, messages: [{ role: "user", content: prompt }] }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const text = (await res.json()).choices[0].message.content.replace(/<think>[\s\S]*?<\/think>/g, "");
  return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
}

async function score(ref, force) {
  const spec = /^\d+$/.test(ref) ? ["-R", REPO, ref] : [ref];
  const pr = JSON.parse(gh("pr", "view", ...spec, "--json", "number,title,body,author,url,baseRefName,headRefName,additions,deletions,changedFiles,files,state"));
  const key = pr.url.replace("https://github.com/", "").replace(/\//g, "-");
  const file = join(SCORES, `${key}.json`);
  if (!force && existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  const diff = gh("pr", "diff", ...spec);
  const result = { pr, blast: blastRadius(pr.files), review: await judge(pr, diff), model: MODEL, at: new Date().toISOString() };
  writeFileSync(file, JSON.stringify(result, null, 2));
  return result;
}

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const repoOf = (pr) => pr.url.split("/").slice(3, 5).join("/");
const effort = (b) => {
  const n = b.score >= 80 ? 5 : b.score >= 60 ? 4 : b.score >= 40 ? 3 : b.score >= 20 ? 2 : 1;
  return { n, label: ["Trivial", "Simple", "Moderate", "Complex", "Critical"][n - 1], mins: Math.max(5, Math.round(b.lines / 8 / 5) * 5) };
};
const KIND = { high: ["⚠️", "Potential issue", "Major"], medium: ["⚠️", "Potential issue", "Minor"], low: ["🛠️", "Refactor suggestion", ""], nit: ["🧹", "Nitpick", ""] };
const VERDICT = { approve: ["Approved", "ok"], comment: ["Commented", "warn"], request_changes: ["Changes requested", "bad"] };
const tone = (v, invert) => ((invert ? 100 - v : v) >= 70 ? "ok" : (invert ? 100 - v : v) >= 40 ? "warn" : "bad");

const CSS = `
:root{--or:#c2410c;--ink:#111;--txt:#1f1f1f;--mut:#6b6b6b;--b:#e6e6e6;--side:#f7f7f7;--head:#efefef;--ok:#15803d;--warn:#b45309;--bad:#b91c1c}
*{box-sizing:border-box}body{margin:0;font:14px/1.5 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--txt);background:#fff;display:flex;min-height:100vh}
a{color:var(--or);text-decoration:none}a:hover{text-decoration:underline}
aside{width:300px;flex:none;background:var(--side);border-right:1px solid var(--b);padding:14px 12px;display:flex;flex-direction:column;gap:2px}
.who{display:flex;align-items:center;gap:8px;padding:6px 8px 14px;font-weight:600}.who .av{width:26px;height:26px;border-radius:50%;background:linear-gradient(135deg,#f59e0b,#c2410c)}.who .pill{font-weight:500;font-size:12px;background:#e8e8e8;border-radius:6px;padding:1px 8px;color:#444}
.grp{font-size:12px;color:#555;padding:14px 8px 6px}.nav{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;color:#333;font-size:15px}.nav:hover{background:#ededed;text-decoration:none}.nav.on{background:#e9e9e9;color:var(--txt)}
.nav svg{width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:1.8;flex:none}.nav .r{margin-left:auto;font-size:12px;color:#777}.nav .r.bd{background:#fde7d3;color:#9a3412;border-radius:6px;padding:0 7px}.nav .r.gr{background:#e4e4e4;border-radius:6px;padding:0 7px;color:#333}
.sub{display:block;margin-left:22px;padding:6px 10px 6px 14px;border-left:2px solid #ddd;color:#333;font-size:15px}.sub.on{border-color:var(--or);color:var(--or)}.sub:hover{text-decoration:none;color:var(--or)}
hr{border:0;border-top:1px solid var(--b);margin:12px 0}
section{flex:1;min-width:0}
.top{display:flex;align-items:center;justify-content:space-between;padding:14px 28px;border-bottom:1px solid var(--b);font-size:16px}
.btn{border:1px solid var(--b);background:#fff;border-radius:8px;padding:8px 14px;font:inherit;font-size:14px;cursor:pointer;color:var(--txt)}.btn.pri{background:var(--ink);color:#fff;border-color:var(--ink);font-weight:500}
.wrap{max-width:1220px;margin:0 auto;padding:28px 40px}
.lead{font-size:15px;color:#333;margin:0 0 18px}
form.bar{display:flex;gap:10px;margin-bottom:16px}form.bar input{flex:1;max-width:420px;border:1px solid var(--b);border-radius:8px;padding:9px 12px 9px 36px;font:inherit;background:#fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23777' stroke-width='2'%3E%3Ccircle cx='11' cy='11' r='7'/%3E%3Cpath d='m20 20-3.5-3.5'/%3E%3C/svg%3E") 11px center/15px no-repeat}
.tbl{border:1px solid var(--b);border-radius:10px;overflow:hidden}.tbl table{width:100%;border-collapse:collapse}.tbl th{background:var(--head);text-align:left;font-weight:500;color:#444;padding:11px 16px;font-size:14px}.tbl td{padding:13px 16px;border-top:1px solid var(--b);font-size:15px;vertical-align:top}
.tbl td a.act{float:right;white-space:nowrap}.tbl td a.act::after{content:" →"}
.pill{display:inline-block;font-size:12px;border-radius:6px;padding:1px 8px;background:#e8e8e8;color:#444;margin-left:6px;vertical-align:middle}.pill.ok{background:#dcfce7;color:#166534}.pill.warn{background:#fef3c7;color:#92400e}.pill.bad{background:#fee2e2;color:#991b1b}
.pg{display:flex;justify-content:flex-end;margin-top:14px}.pg span{border:1px solid var(--b);border-radius:8px;padding:8px 14px;color:#444}
.cmt{border:1px solid var(--b);border-radius:10px;margin:0 0 16px}.cmt .hd{display:flex;align-items:center;gap:8px;background:var(--head);padding:9px 16px;border-bottom:1px solid var(--b);font-size:14px}.cmt .hd .bot{width:20px;height:20px;border-radius:50%;background:var(--or);display:inline-block}.cmt .hd b{font-weight:600}.cmt .hd .mut{color:var(--mut)}.cmt .bd{padding:16px 20px;font-size:15px}
h3{font-size:18px;margin:0 0 10px}h4{font-size:15px;margin:18px 0 8px}details{margin:8px 0}summary{cursor:pointer;font-weight:600;color:#333}
table.md{width:100%;border-collapse:collapse;font-size:14px;margin:6px 0}table.md th,table.md td{border:1px solid var(--b);padding:7px 10px;text-align:left;vertical-align:top}table.md th{background:#f6f6f6;font-weight:600}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px;background:#f2f2f2;border-radius:5px;padding:1px 6px}
.fnd{border:1px solid var(--b);border-radius:8px;margin:10px 0;overflow:hidden}.fnd .fh{background:#f6f6f6;padding:7px 12px;font-size:13px;color:#444;border-bottom:1px solid var(--b)}.fnd .fb{padding:12px 14px}.fnd .fb b{display:block;margin-bottom:4px}.fnd .fb b .sev{font-weight:500;color:var(--mut);font-size:12px;margin-left:6px}
.rings{display:flex;flex-wrap:wrap;gap:16px;margin:6px 0 4px}.ring{width:88px;height:88px;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;background:conic-gradient(var(--c) calc(var(--v)*1%),#e9e9e9 0);position:relative}.ring::before{content:"";position:absolute;inset:7px;border-radius:50%;background:#fff}.ring b,.ring span{position:relative}.ring b{font-size:20px}.ring span{font-size:11px;color:var(--mut);text-align:center;line-height:1.1}.ok{--c:var(--ok)}.warn{--c:var(--warn)}.bad{--c:var(--bad)}
.mut{color:var(--mut)}.tag{display:inline-block;font-size:12px;border-radius:999px;padding:2px 10px;background:#fde7d3;color:#9a3412;margin:2px 6px 2px 0}
.ft{display:flex;gap:16px;border-top:1px solid var(--b);margin-top:14px;padding-top:10px;font-size:13px;color:var(--mut)}
pre{white-space:pre-wrap}`;

const I = {
  puzzle: '<svg viewBox="0 0 24 24"><path d="M14 3a2 2 0 0 1 2 2v2h3v4h-2a2 2 0 0 0 0 4h2v4h-4v-2a2 2 0 0 0-4 0v2H7v-4H5a2 2 0 0 1 0-4h2V7h3V5a2 2 0 0 1 2-2z"/></svg>',
  doc: '<svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg>',
  shield: '<svg viewBox="0 0 24 24"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="m9 12 2 2 4-4"/></svg>',
  code: '<svg viewBox="0 0 24 24"><path d="m8 8-4 4 4 4M16 8l4 4-4 4M14 4l-4 16"/></svg>',
  bolt: '<svg viewBox="0 0 24 24"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>',
  slack: '<svg viewBox="0 0 24 24"><path d="M9 3v6m6 6v6M3 15h6m6-6h6M9 15H6a3 3 0 1 0 3 3zM15 9h3a3 3 0 1 0-3-3z"/></svg>',
  card: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/></svg>',
  users: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0M16 4a3 3 0 0 1 0 6M21 20a6 6 0 0 0-4-5.7"/></svg>',
  book: '<svg viewBox="0 0 24 24"><path d="M4 4h6a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4zM20 4h-6a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h7z"/></svg>',
  chev: '<svg viewBox="0 0 24 24" style="margin-left:auto;width:14px"><path d="m6 9 6 6 6-6"/></svg>',
};

const sidebar = () => `<aside>
<div class="who"><span class="av"></span>${esc(REPO.split("/")[0])} <span class="pill">Local</span></div>
<div class="grp">General</div>
<a class="nav on" href="/">${I.puzzle}General${I.chev}</a>
<a class="sub on" href="/">Reviews</a>
<a class="sub" href="/#open">Open pull requests</a>
<hr>
<a class="nav" href="https://github.com/${esc(REPO)}/pulls">${I.book}GitHub</a>
</aside>`;

const page = (title, actions, body) =>
  `<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width"><title>${esc(title)}</title><style>${CSS}</style></head><body>${sidebar()}
<section><div class="top"><span>${esc(title)}</span><span style="display:flex;gap:10px">${actions}</span></div><div class="wrap">${body}</div></section></body></html>`;

function openPrs() {
  try {
    return JSON.parse(gh("pr", "list", "-R", REPO, "--json", "number,title,author,url,updatedAt,additions,deletions,changedFiles", "--limit", "30"));
  } catch {
    return [];
  }
}

function renderHome() {
  const reviewed = readdirSync(SCORES)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(SCORES, f), "utf8")))
    .sort((a, b) => b.at.localeCompare(a.at));
  const done = new Set(reviewed.map((r) => r.pr.url));
  const rows = reviewed
    .map((r) => {
      const [vl, vt] = VERDICT[r.review.verdict] || ["Commented", "warn"];
      const e = effort(r.blast);
      return `<tr><td><a href="/score?pr=${encodeURIComponent(r.pr.url)}">#${r.pr.number}</a> ${esc(r.pr.title)}<span class="pill">${esc(repoOf(r.pr))}</span></td>
      <td>🎯 ${e.n} (${e.label})</td><td><span class="pill ${tone(r.review.scores.quality)}">${r.review.scores.quality}</span></td><td><span class="pill ${tone(r.blast.score, true)}">${r.blast.score}</span></td>
      <td><span class="pill ${vt}">${vl}</span><a class="act" href="/score?pr=${encodeURIComponent(r.pr.url)}">Review details</a></td></tr>`;
    })
    .join("");
  const open = openPrs()
    .filter((p) => !done.has(p.url))
    .map((p) => `<tr><td><a href="${p.url}">#${p.number}</a> ${esc(p.title)}</td><td>${esc(p.author.login)}</td><td>${p.changedFiles} files <span style="color:var(--ok)">+${p.additions}</span> <span style="color:var(--bad)">-${p.deletions}</span></td>
      <td><a class="act" href="/score?pr=${encodeURIComponent(p.url)}">Review</a></td></tr>`)
    .join("");
  return page(
    "Reviews",
    `<button class="btn pri" form="f">Review pull request</button>`,
    `<p class="lead">Pull requests reviewed for quality, blast radius and actionable comments.</p>
    <form class="bar" id="f" action="/score"><input name="pr" placeholder="Paste a pull request URL or number in ${esc(REPO)}" autofocus></form>
    <div class="tbl"><table><tr><th>Pull request</th><th>Review effort</th><th>Quality</th><th>Blast radius</th><th></th></tr>${rows || `<tr><td colspan=5 class="mut">No reviews yet.</td></tr>`}</table></div>
    <h4 id="open" style="margin-top:28px">Open pull requests in ${esc(REPO)}</h4>
    <div class="tbl"><table><tr><th>Pull request</th><th>Author</th><th>Size</th><th></th></tr>${open || `<tr><td colspan=4 class="mut">Nothing waiting for review.</td></tr>`}</table></div>`,
  );
}

function cohorts(files) {
  const m = new Map();
  for (const w of files) {
    const k = w.file.split("/").slice(0, 3).join("/");
    (m.get(k) || m.set(k, []).get(k)).push(w);
  }
  return [...m].map(([k, ws]) => `<tr><td><b>${esc(k)}</b><br>${ws.map((w) => `<code>${esc(w.file.split("/").pop())}</code>`).join(" ")}</td><td>${ws.map((w) => esc(w.change)).join("<br>")}</td></tr>`).join("");
}

function renderScore(r) {
  const { pr, blast, review: v } = r;
  const [vl, vt] = VERDICT[v.verdict] || ["Commented", "warn"];
  const e = effort(blast);
  const actionable = v.findings.filter((f) => f.severity !== "nit");
  const nits = v.findings.filter((f) => f.severity === "nit");
  const finding = (f) => {
    const [ic, kind, sev] = KIND[f.severity] || KIND.low;
    return `<div class="fnd"><div class="fh"><code>${esc(f.file)}</code></div><div class="fb"><b>${ic} ${kind}${sev ? `<span class="sev">| 🔴 ${sev}</span>` : ""}</b><b style="font-weight:600">${esc(f.title)}</b><span>${esc(f.detail)}</span></div></div>`;
  };
  const when = new Date(r.at).toLocaleString("en-NZ", { dateStyle: "medium", timeStyle: "short" });
  return page(
    `Reviews / #${pr.number}`,
    `<a class="btn" href="/score?pr=${encodeURIComponent(pr.url)}&force=1">Re-review</a><a class="btn pri" href="${pr.url}" style="text-decoration:none">Open in GitHub</a>`,
    `<h3>${esc(pr.title)} <span class="pill ${vt}">${vl}</span></h3>
    <p class="mut" style="margin:0 0 18px">${esc(repoOf(pr))} &middot; ${esc(pr.author.login)} wants to merge <code>${esc(pr.headRefName)}</code> into <code>${esc(pr.baseRefName)}</code> &middot; ${pr.changedFiles} files changed <span style="color:var(--ok)">+${pr.additions}</span> <span style="color:var(--bad)">-${pr.deletions}</span></p>

    <div class="cmt"><div class="hd"><span class="bot"></span><b>pr-scorer</b><span class="mut">bot commented ${esc(when)}</span></div><div class="bd">
      <h4 style="margin-top:0">Walkthrough</h4><p>${esc(v.summary)}</p>
      <h4>Changes</h4><table class="md"><tr><th style="width:38%">Cohort / File(s)</th><th>Summary</th></tr>${cohorts(v.walkthrough || [])}</table>
      <h4>Estimated code review effort</h4><p>🎯 ${e.n} (${e.label}) | ⏱️ ~${e.mins} minutes</p>
      <h4>Scores</h4><div class="rings">
        ${[["Quality", v.scores.quality], ["Blast radius", blast.score, 1], ["Risk", v.scores.correctness_risk, 1], ["Tests", v.scores.test_coverage], ["Readability", v.scores.readability], ["PR hygiene", v.scores.pr_hygiene]]
          .map(([l, n, inv]) => `<div class="ring ${tone(n, inv)}" style="--v:${n}"><b>${n}</b><span>${l}</span></div>`).join("")}
      </div>
      <details><summary>Blast radius details</summary><p>${blast.files} files &middot; ${blast.lines} lines &middot; ${blast.dirs} areas &middot; ${blast.testFiles} test files</p>${blast.hotspots.map((h) => `<span class="tag">${esc(h)}</span>`).join("") || "<span class=mut>No hotspots touched.</span>"}</details>
      <details><summary>Pre-merge checks</summary><table class="md"><tr><th>Check</th><th>Status</th></tr>
        <tr><td>Title check</td><td>${v.scores.pr_hygiene >= 60 ? "✅ Passed" : "⚠️ Warning"}</td></tr>
        <tr><td>Description check</td><td>${(pr.body || "").length > 80 ? "✅ Passed" : "⚠️ Warning"}</td></tr>
        <tr><td>Tests touched</td><td>${blast.testFiles ? "✅ Passed" : "⚠️ Warning"}</td></tr></table></details>
      <div class="ft"><span>Model ${esc(r.model)}</span><span>Reviewed ${esc(when)}</span></div>
    </div></div>

    <div class="cmt"><div class="hd"><span class="bot"></span><b>pr-scorer</b><span class="mut">bot reviewed ${esc(when)}</span></div><div class="bd">
      <p style="margin-top:0"><b>Actionable comments posted: ${actionable.length}</b></p>
      ${actionable.map(finding).join("") || "<p class=mut>None.</p>"}
      ${nits.length ? `<details open><summary>🧹 Nitpick comments (${nits.length})</summary>${nits.map(finding).join("")}</details>` : ""}
      <details><summary>📜 Review details</summary><p><b>Configuration used:</b> defaults<br><b>Review profile:</b> ASSERTIVE<br><b>Files selected for processing (${pr.files.length})</b></p><ul>${pr.files.map((f) => `<li><code>${esc(f.path)}</code> <span class="mut">(+${f.additions} -${f.deletions})</span></li>`).join("")}</ul></details>
    </div></div>`,
  );
}

const DIST = join(import.meta.dirname, "web", "dist");
const MIME = { html: "text/html", js: "text/javascript", css: "text/css", svg: "image/svg+xml", png: "image/png", woff2: "font/woff2" };
const reviewed = () =>
  readdirSync(SCORES)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(SCORES, f), "utf8")))
    .sort((a, b) => b.at.localeCompare(a.at));

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const json = (o) => (res.setHeader("content-type", "application/json"), res.end(JSON.stringify(o)));
    try {
      if (url.pathname === "/api/reviews") return json({ repo: REPO, model: MODEL, baseUrl: BASE_URL, reviewed: reviewed(), open: openPrs() });
      if (url.pathname === "/api/score") return json(await score(url.searchParams.get("pr").trim(), url.searchParams.has("force")));
      if (url.pathname === "/score" && url.searchParams.get("pr")) {
        res.setHeader("content-type", "text/html; charset=utf-8");
        return res.end(renderScore(await score(url.searchParams.get("pr").trim(), url.searchParams.has("force"))));
      }
      // ponytail: serve the built React app when it exists, fall back to the server-rendered pages otherwise
      const ext = url.pathname.split(".").pop();
      const asset = join(DIST, url.pathname);
      if (existsSync(DIST)) {
        const f = MIME[ext] && existsSync(asset) ? asset : join(DIST, "index.html");
        res.setHeader("content-type", `${MIME[f.split(".").pop()] || "text/html"}; charset=utf-8`);
        return res.end(readFileSync(f));
      }
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(renderHome());
    } catch (e) {
      res.statusCode = 500;
      json({ error: e.message });
    }
  })
  .listen(PORT, () => console.log(`PR Scorer on http://localhost:${PORT} (repo ${REPO}, model ${MODEL})`));
