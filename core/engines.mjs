// The review engines: System One scores and gates, CodeReviewer, the language-model prompt, reflection and judge().
import { ensureSidecar } from "./local-models.mjs";
import { askModel, askSystemOne } from "./models.mjs";
import { blastRadius, compressDiff, splitHunks } from "./diff.mjs";
import { extractHeadSha, REVIEW_DEFAULTS } from "./context.mjs";

// Score rubrics (5 levels, index 0..4, mapped to 0..100) and merge gates (yes/no). `risk` gates pass when the answer is no.
export const S1_SCORES = {
  quality: ["Broken or wrong", "Works but sloppy", "Acceptable", "Clean and idiomatic", "Exemplary"],
  correctness_risk: ["No realistic way to break anything", "Low risk", "Moderate risk of regressions", "High risk of regressions", "Very likely to break production"],
  test_coverage: ["No tests for the change", "Minimal tests", "Partial coverage", "Good coverage", "Thorough coverage"],
  readability: ["Hard to follow", "Below average", "Readable", "Clear", "Very clear"],
  pr_hygiene: ["Unclear title and description, mixed concerns", "Weak description or scope", "Adequate", "Well described and focused", "Exemplary title, description and scope"],
  blast_radius: ["Isolated change with no downstream effect", "Small local impact", "Moderate impact on nearby modules", "Wide impact across several areas", "System-wide or critical-path impact (auth, payments, migrations, deploy)"],
};
const S1_GATES = [
  { id: "title", label: "Title check", q: "The pull request title accurately describes the change.", risk: false },
  { id: "description", label: "Description check", q: "The pull request description explains what changed and why.", risk: false },
  { id: "security", label: "Security", q: "The change introduces a security risk (injection, auth bypass, secrets, unsafe deserialisation, SSRF, XSS).", risk: true },
  { id: "complexity", label: "Complexity", q: "The change is more complex than the problem requires.", risk: true },
  { id: "tests", label: "Tests", q: "The change is adequately covered by tests for its risk.", risk: false },
  { id: "docs", label: "Documentation", q: "Documentation is updated wherever behaviour visible to users or developers changed.", risk: false },
  { id: "scope", label: "Scope", q: "The pull request does one focused thing.", risk: false },
  { id: "guidelines", label: "Repository guidelines", q: "The change violates the repository's review guidelines.", risk: true, needsGuide: true },
  { id: "issue_requirements", label: "Issue requirements", q: "Does the pull request diff fulfill the requirements and acceptance criteria described in the linked issue(s)?", risk: false, needsIssues: true },
];
function s1State(pr, diff, c, guide = null, gitHistory = null, linkedIssues = [], learnings = [], incrementalCtx = null, outsideImpact = null, accepted = []) {
  if (c.local) return { pull_request: changeDigest(pr, diff, c.contextChars || 12000) };
  return {
    pull_request: {
      title: pr.title,
      description: (pr.body || "").slice(0, 3000),
      author: pr.author.login,
      base: pr.baseRefName,
      head: pr.headRefName,
      head_sha: pr.headSha || extractHeadSha(pr, gitHistory),
      commits: (gitHistory?.prCommits || []).slice(0, 30).map((cm) => `${cm.sha} ${cm.message}`),
      files: pr.files.map((f) => `${f.path} +${f.additions} -${f.deletions}`).slice(0, 200),
    },
    change_facts: (({ files, lines, dirs, hotspots, testFiles, outsideCallers, outsideFiles }) => ({ files, lines, areas: dirs, sensitive_areas: hotspots, test_files: testFiles, outside_callers: outsideCallers || 0, outside_files: outsideFiles || 0 }))(blastRadius(pr.files, outsideImpact?.outsideCallers || 0, outsideImpact?.uniqueFiles || 0)),
    ...(outsideImpact?.callers?.length
      ? {
          outside_diff_call_graph: {
            affected_outside_callers: outsideImpact.outsideCallers,
            unique_outside_files: outsideImpact.uniqueFiles,
            sampled_call_sites: outsideImpact.callers.slice(0, 6).map((c) => `${c.file}:${c.line} (${c.symbol})`),
          },
        }
      : {}),
    ...(incrementalCtx?.summaryText ? { incremental_review_delta: incrementalCtx.summaryText } : {}),
    ...(linkedIssues?.length
      ? {
          linked_issues: linkedIssues.map((iss) => ({
            number: iss.number,
            repo: iss.repo,
            title: iss.title,
            state: iss.state,
            labels: iss.labels || [],
            requirements: (iss.body || "").slice(0, 1200),
          })),
        }
      : {}),
    ...(guide ? { review_guidelines: guide.text.slice(0, c.contextChars ? Math.floor(c.contextChars / 4) : 12000) } : {}),
    ...(learnings?.length
      ? {
          repository_team_learnings: `Repository Team Learnings (Never flag these dismissed patterns):\n${learnings.map((l, i) => `${i + 1}. ${l}`).join("\n")}`,
        }
      : {}),
    ...(accepted?.length ? { fixes_this_team_accepted_before: accepted.slice(-10) } : {}),
    ...(gitHistory?.formatted ? { git_change_history: gitHistory.formatted.slice(0, 4000) } : {}),
    diff: compressDiff(diff, c.contextChars || 80000).diff,
  };
}
// What a small-context System One model reads instead of the head of the raw diff: the whole change in outline (every file
// with its line counts, tests, areas), then the largest hunks until the budget runs out. The model makes every call.
export function changeDigest(pr, diff, maxChars) {
  const facts = blastRadius(pr.files || []);
  const files = [...(pr.files || [])].sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions));
  // gh lists at most 100 files; the pull request's own totals are exact
  const total = Math.max(files.length, Number(pr.changedFiles) || 0);
  const add = Number(pr.additions) || files.reduce((n, f) => n + f.additions, 0);
  const del = Number(pr.deletions) || files.reduce((n, f) => n + f.deletions, 0);
  let out = [
    `Title: ${pr.title}`,
    `Description: ${String(pr.body || "").replace(/\s+/g, " ").trim().slice(0, 400) || "(none)"}`,
    `Change: ${total} files, +${add} -${del} lines, ${facts.testFiles} test files, ${facts.dirs} areas${facts.hotspots.length ? `, touches ${facts.hotspots.join(", ")}` : ""}.`,
    "Files:",
  ].join("\n");
  const fileEnd = out.length + Math.floor(maxChars * 0.35);
  let shown = 0;
  for (const f of files) {
    const line = `\n${f.path} +${f.additions} -${f.deletions}`;
    if (out.length + line.length > fileEnd) break;
    out += line;
    shown++;
  }
  if (shown < total) out += `\n(${total - shown} more files)`;
  out += "\nLargest hunks:";
  for (const h of splitHunks(diff, 60, 1200)) {
    const block = `\n--- ${h.file} ${h.header}\n${h.diff.trimEnd()}`;
    if (out.length + block.length > maxChars) { out += block.slice(0, Math.max(0, maxChars - out.length)); break; }
    out += block;
  }
  return out.slice(0, maxChars);
}

export async function scoreWithSystemOne(pr, diff, c, guide, onPartial, gitHistory, linkedIssues = [], learnings = [], incrementalCtx = null, outsideImpact = null, accepted = []) {
  const state = s1State(pr, diff, c, guide, gitHistory, linkedIssues, learnings, incrementalCtx, outsideImpact, accepted);
  const questions = {};
  for (const [k, levels] of Object.entries(S1_SCORES)) questions[`score_${k}`] = { type: "score", instructions: `Rate the pull request's ${k.replace("_", " ")}.`, criteria: levels };
  for (const g of S1_GATES) if ((!g.needsGuide || (guide && !c.local)) && (!g.needsIssues || (linkedIssues?.length && !c.local))) questions[`gate_${g.id}`] = { type: "noul", instructions: g.q };
  let a;
  try {
    a = await askSystemOne(state, questions, c, onPartial ? (partial) => {
      const readyScores = {};
      for (const k of Object.keys(S1_SCORES)) {
        if (partial[`score_${k}`] !== undefined) readyScores[k] = Math.max(0, Math.min(100, Math.round((Number(partial[`score_${k}`]?.score) || 0) / 4 * 100)));
      }
      const gates = S1_GATES.filter((g) => partial[`gate_${g.id}`] !== undefined).map((g) => {
        const yes = Number(partial[`gate_${g.id}`].noul) || 0;
        return { id: g.id, label: g.label, yes: Math.round(yes * 100) / 100, pass: g.risk ? yes < 0.5 : yes >= 0.5 };
      });
      onPartial({ readyScores, gates, done: false });
    } : undefined);
  } catch (err) {
    throw new Error(`System One model ${c.provider}/${c.model} failed: ${err.message}`);
  }
  const missing = Object.keys(questions).filter((k) => !Number.isFinite(Number(a?.[k]?.[questions[k].type === "score" ? "score" : "noul"] ?? NaN)));
  if (missing.length) throw new Error(`System One model ${c.provider}/${c.model} did not answer: ${missing.join(", ")}`);
  const scores = Object.fromEntries(Object.keys(S1_SCORES).map((k) => [k, Math.max(0, Math.min(100, Math.round((Number(a[`score_${k}`]?.score) || 0) / 4 * 100)))]));
  const gates = S1_GATES.filter((g) => a[`gate_${g.id}`]).map((g) => { const yes = Number(a[`gate_${g.id}`].noul) || 0; return { id: g.id, label: g.label, yes: Math.round(yes * 100) / 100, pass: g.risk ? yes < 0.5 : yes >= 0.5 }; });
  onPartial?.({ readyScores: scores, gates, done: true });
  return { scores, gates };
}
async function reviewWithCodeReviewer(pr, diff, c, guide, gitHistory, onProgress = null, linkedIssues = [], learnings = [], incrementalCtx = null) {
  const activeDiff = incrementalCtx?.deltaDiff || diff;
  const hunks = splitHunks(activeDiff);
  const files = [...new Set(hunks.map((h) => h.file))];
  const commitNote = incrementalCtx?.newCommits?.length
    ? ` Incremental delta ${incrementalCtx.prevSha.slice(0, 7)} -> ${incrementalCtx.headSha.slice(0, 7)} (${incrementalCtx.newCommits.length} new commit(s)).`
    : gitHistory?.prCommits?.length
      ? ` Analyzed ${gitHistory.prCommits.length} commit(s) (${gitHistory.prCommits.slice(0, 3).map((x) => x.sha).join(", ")})`
      : "";
  const guideNote = guide?.file ? ` against ${guide.file} guidelines` : "";
  const issueNote = linkedIssues?.length ? ` Validated against linked issue(s) ${linkedIssues.map((i) => `#${i.number}`).join(", ")}.` : "";
  const learningNote = learnings?.length ? ` Enforced ${learnings.length} repository team learning(s).` : "";
  const port = await ensureSidecar(c.local);
  const seen = new Set();
  const findings = [];
  const rawLog = [];
  const batchSize = 4;
  for (let start = 0; start < hunks.length; start += batchSize) {
    const batch = hunks.slice(start, start + batchSize);
    const res = await fetch(`http://127.0.0.1:${port}/v1/review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hunks: batch.map((h) => ({ file: h.file, diff: h.diff })) }),
      signal: AbortSignal.timeout(900000),
    });
    if (!res.ok) throw new Error(`Review engine ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const { comments } = await res.json();
    for (let bi = 0; bi < batch.length; bi++) {
      const h = batch[bi];
      const cm = (comments || []).find((x) => x.index === bi);
      const text = String(cm?.comment || "").trim();
      rawLog.push(`[Hunk ${start + bi + 1}/${hunks.length}] ${h.file} ${h.header}\n${text ? `-> ${text}` : "-> ✓ Clean hunk (no issues flagged)"}`);
      if (!text || text.length < 12 || seen.has(text.toLowerCase())) continue;
      seen.add(text.toLowerCase());
      const first = text.split(/(?<=[.!?])\s/)[0];
      const titleCandidate = first.length > 90 ? first.slice(0, 87) + "…" : first;
      const isDismissedByRule = (learnings || []).some((rule) => {
        const norm = String(rule).toLowerCase();
        return norm.includes(titleCandidate.toLowerCase().slice(0, 40)) || (h.file && norm.includes(`[${h.file.toLowerCase()}]`) && norm.includes(first.toLowerCase().slice(0, 24)));
      });
      if (isDismissedByRule) continue;
      findings.push(
        deriveSuggestionFromDetail(
          {
            file: h.file,
            severity: /bug|wrong|incorrect|leak|crash|null|undefined|security|inject|unsafe|race|deadlock|error/i.test(text) ? "medium" : "low",
            title: titleCandidate,
            detail: `${text}\n\n${h.header}\n${h.diff.trim()}`,
          },
          activeDiff,
        ),
      );
    }
    const doneHunks = Math.min(hunks.length, start + batch.length);
    onProgress?.({
      summary: `CodeOtter inspected ${doneHunks} of ${hunks.length} diff hunks across ${files.length} changed files${guideNote}.${commitNote}${issueNote}${learningNote} Found ${findings.length} actionable observation(s) so far.`,
      findings: findings.slice(0, 20),
      walkthrough: files.map((f) => ({ file: f, change: `${hunks.filter((h) => h.file === f).length} hunk(s) reviewed` })),
      rawOutput: rawLog.join("\n\n"),
    });
  }
  return {
    summary: `CodeOtter reviewed ${hunks.length} diff hunks across ${files.length} changed files${guideNote}.${commitNote}${issueNote}${learningNote} Found ${findings.length} actionable observation(s).`,
    verdict: findings.some((f) => f.severity === "medium") ? "comment" : findings.length ? "comment" : "approve",
    scores: { quality: 0, correctness_risk: 0, test_coverage: 0, readability: 0, pr_hygiene: 0 },
    findings: findings.slice(0, 20),
    walkthrough: files.map((f) => ({ file: f, change: `${hunks.filter((h) => h.file === f).length} hunk(s) reviewed` })),
    rawOutput: rawLog.join("\n\n"),
  };
}

// CodeReviewer writes a comment for every hunk, including questions and style remarks. System One reads each comment with
// its hunk and keeps only those that name a concrete problem in the change. Fails the review if System One fails.
const S1_FINDING_MIN = 0.7; // accuracy over coverage: keep a comment only when System One is clearly confident
const S1_FINDING_CHECK = "The review comment points to a concrete problem in this code change (a bug, broken or missing behaviour, a security issue, or a missing test for changed logic). Answer no for questions, guesses, style or naming preferences, and comments the code change does not support.";
export async function verifyFindingsWithSystemOne(findings, s1, onProgress = null) {
  const kept = [];
  for (const [i, f] of findings.entries()) {
    const [comment, ...hunk] = String(f.detail || "").split("\n\n");
    const room = Math.max(400, (s1.contextChars || 4000) - comment.length - f.file.length - 400);
    const state = { file: f.file, review_comment: comment, code_change: hunk.join("\n\n").slice(0, room) };
    let a;
    try {
      a = await askSystemOne(state, { finding_valid: { type: "noul", instructions: S1_FINDING_CHECK } }, s1);
    } catch (err) {
      throw new Error(`System One model ${s1.provider}/${s1.model} failed while checking review comments: ${err.message}`);
    }
    const yes = Number(a?.finding_valid?.noul);
    if (!Number.isFinite(yes)) throw new Error(`System One model ${s1.provider}/${s1.model} did not answer the review comment check`);
    if (yes >= S1_FINDING_MIN) kept.push({ ...f, confidence: Math.round(yes * 100) / 100 });
    onProgress?.(i + 1, findings.length, kept.length);
  }
  return kept.sort((x, y) => y.confidence - x.confidence);
}

function findFileLineInDiff(file, diff) {
  if (!file || !diff) return 0;
  const lines = String(diff).split("\n");
  let inFile = false;
  let curLine = 0;
  for (const l of lines) {
    if (l.startsWith("diff --git")) {
      inFile = l.endsWith(` b/${file}`) || l.includes(` b/${file} `);
      curLine = 0;
      continue;
    }
    if (l.startsWith("+++ ")) {
      const target = l.slice(4).replace(/^b\//, "").trim();
      inFile = target === file;
      continue;
    }
    if (!inFile) continue;
    const hm = l.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hm) {
      curLine = parseInt(hm[1], 10);
      continue;
    }
    if (curLine > 0) {
      if (l.startsWith("+") && !l.startsWith("+++")) return curLine;
      if (l.startsWith("-") && !l.startsWith("---")) return curLine;
      if (l.startsWith(" ")) curLine++;
    }
  }
  return 0;
}

export function deriveSuggestionFromDetail(f, diff = "") {
  const str = (x, max) => String(x ?? "").replace(/<!--[\s\S]*?(-->|$)/g, "").slice(0, max); // no HTML comments: they could forge CodeOtter's own comment markers
  const SEV_MAP = {
    blocker: "high",
    major: "medium",
    minor: "low",
    high: "high",
    medium: "medium",
    low: "low",
    nit: "nit",
  };
  const rawSev = String(f?.severity || "low").toLowerCase();
  const severity = SEV_MAP[rawSev] || "low";
  const file = str(f?.file, 300).trim();
  const title = str(f?.title, 300).trim();
  let detail = str(f?.detail, 4000);

  // 1. Determine target line in new file
  let line = Number.isFinite(Number(f?.line)) && Number(f.line) > 0 ? Math.round(Number(f.line)) : 0;
  if (!line && detail) {
    const hunkMatch = detail.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@([^\n]*)\n([\s\S]*)/);
    if (hunkMatch) {
      let curLine = parseInt(hunkMatch[1], 10);
      let foundLine = 0;
      for (const hl of hunkMatch[3].split("\n")) {
        if (hl.startsWith("+++") || hl.startsWith("---")) continue;
        if (hl.startsWith("+") || hl.startsWith("-")) {
          foundLine = curLine;
          break;
        }
        if (hl.startsWith(" ")) curLine++;
      }
      line = foundLine || parseInt(hunkMatch[1], 10);
    } else {
      const hmSimple = detail.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (hmSimple) line = parseInt(hmSimple[1], 10);
    }
  }
  if (!line && detail) {
    const lineRef = detail.match(/(?:\bline\s+|[:#]L|\bL)(\d{1,6})\b/i);
    if (lineRef) line = parseInt(lineRef[1], 10);
  }
  if (!line && file && diff) {
    line = findFileLineInDiff(file, diff);
  }

  // 2. Determine replacement suggestion snippet (without markdown backticks)
  let suggestion = "";
  if (typeof f?.suggestion === "string" && f.suggestion.trim()) {
    suggestion = f.suggestion
      .trim()
      .replace(/^```(?:suggestion|[a-zA-Z0-9_-]*)\r?\n?/i, "")
      .replace(/\r?\n?```$/i, "")
      .replace(/\r?\n$/, "");
  }
  if (!suggestion && detail) {
    const sugFence = detail.match(/```suggestion\r?\n([\s\S]*?)```/i);
    if (sugFence) {
      suggestion = sugFence[1].replace(/\r?\n$/, "");
      detail = detail.replace(sugFence[0], "").trim();
    } else {
      const explanationPart = detail.split("\n\n@@")[0] || detail;
      const codeFence = explanationPart.match(/```(?:[a-zA-Z0-9_-]*)\r?\n([\s\S]*?)```/);
      if (codeFence && codeFence[1].trim()) {
        const inner = codeFence[1].replace(/\r?\n$/, "");
        if (!inner.startsWith("@@")) {
          const plusLines = inner
            .split("\n")
            .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
            .map((l) => l.slice(1));
          suggestion = plusLines.length ? plusLines.join("\n") : inner;
        }
      } else {
        const inlineReplace = explanationPart.match(/(?:replace\s+with|change\s+to|use\s+instead|suggested\s+fix|fix)\s*[:：]?\s*`([^`\n]{3,240})`/i);
        if (inlineReplace) {
          suggestion = inlineReplace[1].trim();
        }
      }
    }
  }

  const startLine = Math.round(Number(f?.startLine));
  return {
    file,
    ...(line > 0 ? { line } : {}),
    // A suggestion that replaces lines startLine..line (multi-line); absent means it replaces `line` only.
    ...(line > 0 && startLine > 0 && startLine < line && line - startLine < 200 ? { startLine } : {}),
    severity,
    title,
    detail,
    ...(suggestion ? { suggestion: str(suggestion, 2000) } : {}),
    ...(f?.dismissed ? { dismissed: true } : {}),
    ...(Number.isFinite(Number(f?.confidence)) && f?.confidence !== null && f?.confidence !== "" ? { confidence: Math.max(0, Math.min(1, Number(f.confidence))) } : {}),
  };
}

function prompt(pr, diff, c, r = REVIEW_DEFAULTS, guide = null, wantScores = true, gitHistory = null, linkedIssues = [], learnings = [], incrementalCtx = null, outsideImpact = null, accepted = []) {
  const outsideBlock = outsideImpact?.formatted ? `\n${outsideImpact.formatted}\n` : "";
  const issueBlock = linkedIssues?.length
    ? `\nLinked Issues & Requirements (MANDATORY: explicitly verify whether the pull request diff fulfills all requirements and acceptance criteria described in these linked issues, and flag any unfulfilled or partially met requirement in findings):\n${linkedIssues
        .map((iss) => `Issue #${iss.number} (${iss.repo}, ${iss.state}): ${iss.title}${iss.labels?.length ? ` [${iss.labels.join(", ")}]` : ""}\n${(iss.body || "(no body provided)").slice(0, 1200)}`)
        .join("\n\n")}\n`
    : "";
  const learningsBlock = learnings?.length
    ? `\nRepository Team Learnings (Never flag these dismissed patterns):\n${learnings.map((l) => `- ${l}`).join("\n")}\n`
    : "";
  const incrementalBlock = incrementalCtx?.promptBlock ? `\n${incrementalCtx.promptBlock}\n` : "";
  const acceptedBlock = accepted?.length
    ? `\nFixes this team accepted from earlier reviews (look for the same kinds of problems):\n${accepted.slice(-10).map((a) => `- ${a}`).join("\n")}\n`
    : "";
  return `You are CodeOtter, a strict senior staff code reviewer. Review this pull request using the repository's review guidelines (AGENTS.md / CLAUDE.md), the repository team learnings, the linked issues and acceptance criteria, the git commit history, the outside-diff call graph context, and the code diff. Reply with ONLY a JSON object:
{"summary":"3-5 sentence architectural walkthrough covering what changed, commit progression, fulfillment of linked issue requirements, adherence to repository guidelines, and outside caller safety","verdict":"approve|comment|request_changes",
${wantScores ? ` "scores":{"quality":0-100,"correctness_risk":0-100 (100 = very risky),"test_coverage":0-100,"readability":0-100,"pr_hygiene":0-100 (title, description, scope, commit focus),"blast_radius":0-100 (100 = system-wide or critical-path impact)},\n` : ""} "findings":[{"severity":"blocker|major|minor|nit|high|medium|low","file":"path","line":42,"title":"short","detail":"specific line/behaviour and fix (cite AGENTS.md/CLAUDE.md rule, linked issue #number requirement, or commit if relevant)","suggestion":"optional exact replacement code"}],
 "walkthrough":[{"file":"path","change":"concise summary of change in this file"}]}
For each finding, include the integer target \`line\` number in the new file and an optional \`suggestion\` containing the exact replacement code snippet for the target line/block (without markdown backticks) so the fix can be applied in one click. Be concrete; cite exact files and rules. Respect all Repository Team Learnings and never flag dismissed patterns. Max ${r.maxFindings} findings, most severe first. Today is ${new Date().toISOString().slice(0, 10)}.

PR #${pr.number}: ${pr.title}
Author: ${pr.author.login}  Base: ${pr.baseRefName} <- Head: ${pr.headRefName}${pr.headSha ? ` (${pr.headSha.slice(0, 7)})` : ""}  Files: ${pr.changedFiles}  +${pr.additions} -${pr.deletions}
Description:
${(pr.body || "(none)").slice(0, c.contextChars ? Math.min(3000, Math.floor(c.contextChars / 10)) : 3000)}
${outsideBlock}${incrementalBlock}${issueBlock}${learningsBlock}${acceptedBlock}${gitHistory?.formatted ? `\nGit Change History (commits in this PR and recent target branch history):\n${gitHistory.formatted.slice(0, 4000)}\n` : ""}${guide ? `\nRepository Review Guidelines from ${guide.file} (MANDATORY: verify all code changes and commits against these rules and flag any violation in findings):\n${guide.text}\n` : ""}
Diff${diff.length > Math.min(r.diffChars, c.contextChars || Infinity) ? " (over budget: highest-priority files first, the rest named at the end)" : ""}:
${compressDiff(diff, Math.min(r.diffChars, c.contextChars || Infinity)).diff}`;
}

// <reflect>
// Self-reflection: a second pass of the same model scores each finding 0-10 against the diff, as a skeptical reviewer.
// Findings below the configured minimum are dropped; the rest are ordered by that score. A failed pass fails the review.
export async function reflectFindings(pr, diff, c, r, findings) {
  const list = findings.map((f, i) => `${i}. [${f.severity}] ${f.file}${f.line ? `:${f.line}` : ""}: ${f.title}\n${String(f.detail || "").slice(0, 800)}${f.suggestion ? `\nSuggested code:\n${f.suggestion.slice(0, 600)}` : ""}`).join("\n\n");
  const text = await askModel(`You are checking another reviewer's findings on pull request #${pr.number} (${pr.title}). For each finding, score 0-10 how sure you are that it names a real, concrete problem that this diff introduces or leaves broken and that the author should fix: 0 = wrong, not supported by the diff, or a question or style preference; 5 = plausible but unproven; 10 = certain defect. A suggested fix that is wrong lowers the score. Reply with ONLY a JSON object: {"scores":[{"index":0,"score":0-10,"why":"one sentence"}]}

Findings:
${list}

Diff:
${compressDiff(diff, Math.min(r.diffChars, c.contextChars || Infinity)).diff}`, { ...c, temperature: 0 });
  let out;
  try {
    out = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  } catch {
    throw new Error(`${c.provider}/${c.model} did not return valid JSON when checking its findings`);
  }
  const scores = new Map((Array.isArray(out.scores) ? out.scores : []).map((x) => [Number(x?.index), Number(x?.score)]).filter(([i, v]) => Number.isInteger(i) && Number.isFinite(v)));
  if (findings.some((_, i) => !scores.has(i))) throw new Error(`${c.provider}/${c.model} did not score every finding when checking them`);
  return findings
    .map((f, i) => ({ ...f, confidence: Math.max(0, Math.min(10, Math.round(scores.get(i)))) / 10 }))
    .filter((f) => f.confidence * 10 >= r.reflectMin)
    .sort((a, b) => b.confidence - a.confidence);
}
// </reflect>

export async function judge(pr, diff, c, r = REVIEW_DEFAULTS, guide = null, wantScores = true, gitHistory = null, onProgress = null, linkedIssues = [], learnings = [], incrementalCtx = null, outsideImpact = null, accepted = []) {
  if (c.api === "codereviewer") return reviewWithCodeReviewer(pr, diff, c, guide, gitHistory, onProgress, linkedIssues, learnings, incrementalCtx);
  const text = await askModel(prompt(pr, diff, c, r, guide, wantScores, gitHistory, linkedIssues, learnings, incrementalCtx, outsideImpact, accepted), { ...c, temperature: r.temperature });
  let out;
  try {
    out = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  } catch {
    throw new Error("The model did not return valid JSON; try again or pick another model");
  }
  const n = (x) => Math.max(0, Math.min(100, Math.round(Number(x)) || 0));
  const str = (x, max) => String(x ?? "").replace(/<!--[\s\S]*?(-->|$)/g, "").slice(0, max); // no HTML comments: they could forge CodeOtter's own comment markers
  const scoreKeys = ["quality", "correctness_risk", "test_coverage", "readability", "pr_hygiene", "blast_radius"];
  if (wantScores) {
    const missing = scoreKeys.filter((k) => out.scores?.[k] === null || out.scores?.[k] === "" || !Number.isFinite(Number(out.scores?.[k])));
    if (missing.length) throw new Error(`${c.provider}/${c.model} returned no usable scores for: ${missing.join(", ")}`);
  }
  let findings = (Array.isArray(out.findings) ? out.findings : []).slice(0, 20).map((f) => deriveSuggestionFromDetail(f, diff));
  let reflected = "";
  if (r.reflectMin > 0 && findings.length) {
    onProgress?.({ summary: `Checking ${findings.length} finding(s) against the diff…` });
    const before = findings.length;
    findings = await reflectFindings(pr, diff, c, r, findings);
    reflected = ` Self-check kept ${findings.length} of ${before} finding(s).`;
  }
  return {
    summary: str(out.summary, 2500 - reflected.length) + reflected,
    verdict: ["approve", "comment", "request_changes"].includes(out.verdict) ? out.verdict : "comment",
    scores: Object.fromEntries(scoreKeys.slice(0, 5).map((k) => [k, n(out.scores?.[k])])),
    ...(wantScores ? { blastRadius: n(out.scores.blast_radius) } : {}),
    findings,
    walkthrough: (Array.isArray(out.walkthrough) ? out.walkthrough : []).slice(0, 100).filter((w) => w && typeof w.file === "string").map((w) => ({ file: str(w.file, 300), change: str(w.change, 500) })),
    rawOutput: str(text, 20000),
  };
}
