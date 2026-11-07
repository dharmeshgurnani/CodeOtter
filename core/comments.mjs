// Pull request comment bodies: scores, review and the blast-radius diagram.
import { APP_URL } from "./config.mjs";
import { HOTSPOTS } from "./diff.mjs";
import { deriveSuggestionFromDetail, S1_SCORES } from "./engines.mjs";
import { effort, VERDICT } from "./views.mjs";

export function formatScoresComment(r) {
  const { pr, blast, review: v, gates = [], linkedIssues = [], headSha, incremental } = r;
  const appLink = `${APP_URL}/review?pr=${encodeURIComponent(pr.url)}`;
  const levelOf = (key, val) => S1_SCORES[key]?.[Math.min(4, Math.max(0, Math.round((Number(val) || 0) / 25)))] || "";
  const rows = [
    ["Quality", v.scores.quality, levelOf("quality", v.scores.quality)],
    ["Blast radius", blast.score, levelOf("blast_radius", blast.score)],
    ["Correctness risk", v.scores.correctness_risk, levelOf("correctness_risk", v.scores.correctness_risk)],
    ["Test coverage", v.scores.test_coverage, levelOf("test_coverage", v.scores.test_coverage)],
    ["Readability", v.scores.readability, levelOf("readability", v.scores.readability)],
    ["PR hygiene", v.scores.pr_hygiene, levelOf("pr_hygiene", v.scores.pr_hygiene)],
  ];
  const shaNote = incremental
    ? `⚡ **Incremental delta:** \`${incremental.prevSha.slice(0, 7)}\` → \`${incremental.headSha.slice(0, 7)}\` (${incremental.newCommits.length} new commit${incremental.newCommits.length === 1 ? "" : "s"})`
    : headSha
      ? `**Reviewed commit:** \`${headSha.slice(0, 7)}\``
      : "";
  const lines = [
    `<!-- codeotter:scores -->`,
    `### 🦦 CodeOtter — Review Scores`,
    ...(shaNote ? ["", shaNote] : []),
    ...(linkedIssues.length
      ? ["", `**Linked issue(s):** ${linkedIssues.map((i) => `[#${i.number} ${i.title}](${i.url})`).join(" · ")}`]
      : []),
    "",
    `| Metric | Score | Assessment |`,
    `| :--- | :---: | :--- |`,
    ...rows.map(([label, score, desc]) => `| **${label}** | **${score}** / 100 | ${desc} |`),
  ];
  const checkRows = [
    ...gates.map((g) => `| ${g.label} | ${g.pass ? "✅ Passed" : "⚠️ Warning"} (${Math.round(g.yes * 100)}% yes) |`),
    ...(linkedIssues.length && !gates.some((g) => g.id === "issue_requirements")
      ? [`| Issue requirements | ${v.verdict !== "request_changes" && v.scores.quality >= 60 ? "✅ Passed" : "⚠️ Warning"} (${linkedIssues.map((i) => `#${i.number}`).join(", ")}) |`]
      : []),
  ];
  if (checkRows.length) {
    lines.push(
      "",
      "#### Pre-merge checks",
      "| Gate | Status |",
      "| :--- | :--- |",
      ...checkRows,
    );
  }
  lines.push(
    "",
    `---`,
    `🔗 **[View full review details on CodeOtter →](${appLink})**`,
  );
  return lines.join("\n");
}
const formatScorecardComment = formatScoresComment;

function cleanMermaidText(s, max = 42) {
  const clean = String(s || "")
    .replace(/["[\]`<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function buildBlastMermaid(r) {
  const { pr: p, blast: b = {}, review: v = {} } = r;
  const files = p.files?.length
    ? p.files
    : (v.walkthrough || []).map((w) => ({ path: w.file, additions: 0, deletions: 0 }));
  const walkMap = new Map();
  for (const w of v.walkthrough || []) {
    if (w?.file && w?.change) walkMap.set(w.file, w.change);
  }

  const out = [
    "flowchart LR",
    "  classDef pr fill:#111c2d,stroke:#38bdf8,stroke-width:2px,color:#f8fafc",
    "  classDef cohort fill:#131b26,stroke:#64748b,stroke-width:1.5px,color:#f1f5f9",
    "  classDef file fill:#0b1017,stroke:#334155,stroke-width:1px,color:#e2e8f0",
    "  classDef hotspot fill:#291507,stroke:#f59e0b,stroke-width:2px,color:#fef3c7",
    "  classDef test fill:#072415,stroke:#22c55e,stroke-width:1.5px,color:#dcfce7",
  ];

  const prHead = cleanMermaidText(p.headRefName || "head", 20);
  const prBase = cleanMermaidText(p.baseRefName || "main", 18);
  out.push(
    `  PR["PR #${p.number}: ${prHead} -> ${prBase}<br/>${p.changedFiles} file(s) (+${p.additions} / -${p.deletions}) · Blast ${b.score ?? 0}/100"]:::pr`,
  );

  const cohortMap = new Map();
  for (const f of files) {
    const parts = f.path.split("/");
    const key = parts.length > 1 ? parts.slice(0, Math.min(2, parts.length - 1)).join("/") : "(root)";
    cohortMap.set(key, [...(cohortMap.get(key) || []), f]);
  }

  const cohortEntries = [...cohortMap.entries()].slice(0, 6);
  const cohortNodeIds = new Map();

  cohortEntries.forEach(([cohortKey, cFiles], cIdx) => {
    const cid = `C${cIdx}`;
    cohortNodeIds.set(cohortKey, cid);
    const add = cFiles.reduce((n, f) => n + (f.additions || 0), 0);
    const del = cFiles.reduce((n, f) => n + (f.deletions || 0), 0);
    out.push(`  ${cid}["${cleanMermaidText(cohortKey, 26)} (${cFiles.length})<br/>+${add} / -${del}"]:::cohort`);
    out.push(`  PR --> ${cid}`);
  });

  let fileCounter = 0;
  const maxFilesShown = 8;
  const hotspotLinks = new Map();
  for (const h of b.hotspots || []) hotspotLinks.set(h, new Set());

  cohortEntries.forEach(([cohortKey, cFiles]) => {
    const cid = cohortNodeIds.get(cohortKey);
    for (const f of cFiles) {
      for (const [hName, re] of HOTSPOTS) {
        if (re.test(f.path)) {
          if (!hotspotLinks.has(hName)) hotspotLinks.set(hName, new Set());
          hotspotLinks.get(hName).add(cid);
        }
      }
      if (fileCounter >= maxFilesShown) continue;
      const fid = `F${fileCounter++}`;
      const base = f.path.split("/").pop() || f.path;
      const isTest = /test|spec|__tests__/i.test(f.path);
      const wChange = walkMap.get(f.path);
      const summaryBit = wChange ? ` · ${cleanMermaidText(wChange, 22)}` : "";
      const role = isTest ? "test" : "file";
      const prefix = isTest ? "🧪 " : "";
      out.push(
        `  ${fid}["${prefix}${cleanMermaidText(base, 24)}<br/>+${f.additions} / -${f.deletions}${summaryBit}"]:::${role}`,
      );
      out.push(`  ${cid} --> ${fid}`);
    }
  });

  if (files.length > maxFilesShown) {
    const rem = files.length - maxFilesShown;
    out.push(`  FMORE["+${rem} more modified file(s)<br/>In ${cohortMap.size} cohort(s)"]:::file`);
    out.push(`  ${cohortNodeIds.values().next().value || "PR"} --> FMORE`);
  }

  let hIdx = 0;
  for (const [hName, fromIds] of hotspotLinks.entries()) {
    const hid = `H${hIdx++}`;
    out.push(`  ${hid}["⚠️ Hotspot: ${cleanMermaidText(hName, 24)}<br/>Blast radius impact"]:::hotspot`);
    if (fromIds.size) {
      for (const src of fromIds) out.push(`  ${src} -.-> ${hid}`);
    } else {
      out.push(`  PR -.-> ${hid}`);
    }
  }

  const testCount = b.testFiles ?? files.filter((f) => /test|spec|__tests__/i.test(f.path)).length;
  if (testCount > 0) {
    out.push(`  TVERIFY["🧪 ${testCount} Test File(s)<br/>Verifying cohort changes"]:::test`);
    const firstCohort = cohortNodeIds.values().next().value || "PR";
    out.push(`  ${firstCohort} --> TVERIFY`);
  } else {
    out.push(`  TNONE["⚠️ 0 Test Files<br/>No test coverage in diff"]:::hotspot`);
    out.push(`  PR -.-> TNONE`);
  }

  if (r.outsideDiffImpact?.callers?.length) {
    out.push("  classDef outside fill:#261205,stroke:#ea580c,stroke-width:1.5px,color:#ffedd5");
    const topCallers = r.outsideDiffImpact.callers.slice(0, 4);
    topCallers.forEach((c, idx) => {
      const ocid = `OC${idx}`;
      const baseFile = c.file.split("/").pop() || c.file;
      out.push(`  ${ocid}["🌐 Outside: ${cleanMermaidText(baseFile, 18)}:${c.line}<br/>calls ${cleanMermaidText(c.symbol, 16)}()"]:::outside`);
      const firstCohort = cohortNodeIds.values().next().value || "PR";
      out.push(`  ${firstCohort} -.->|calls ${cleanMermaidText(c.symbol, 14)}| ${ocid}`);
    });
  }

  return out.join("\n");
}

export function formatReviewComment(r) {
  const { pr, blast, review: v, linkedIssues = [], headSha, incremental } = r;
  const appLink = `${APP_URL}/review?pr=${encodeURIComponent(pr.url)}`;
  const [vl] = VERDICT[v.verdict] || ["Commented"];
  const e = effort(blast);
  const actionable = (v.findings || []).filter((f) => !f.dismissed && f.severity !== "nit").map((f) => deriveSuggestionFromDetail(f, ""));
  const resolved = incremental?.resolvedFindings || [];
  const lines = [
    `<!-- codeotter:review -->`,
    `### 🦦 CodeOtter — PR Review Summary`,
    "",
    `**Verdict:** ${vl} · **Review effort:** 🎯 ${e.n} (${e.label}, ~${e.mins} min) · **Actionable findings:** ${actionable.length}${headSha ? ` · **Commit:** \`${headSha.slice(0, 7)}\`` : ""}`,
    ...(incremental
      ? [
          "",
          `⚡ **Incremental delta:** \`${incremental.prevSha.slice(0, 7)}\` → \`${incremental.headSha.slice(0, 7)}\` (${incremental.newCommits.length} new commit${incremental.newCommits.length === 1 ? "" : "s"})${resolved.length ? ` · ✅ **${resolved.length} prior finding${resolved.length === 1 ? "" : "s"} resolved**` : ""}`,
        ]
      : []),
    ...(linkedIssues.length
      ? [
          "",
          `#### Linked Issues & Requirements`,
          ...linkedIssues.map((i) => {
            const req = (i.body || "").trim().replace(/\s+/g, " ").slice(0, 220);
            return `- [#${i.number} ${i.title}](${i.url})${i.state ? ` (${i.state})` : ""}${req ? ` — ${req}${(i.body || "").trim().length > 220 ? "…" : ""}` : ""}`;
          }),
        ]
      : []),
    "",
    `#### Summary`,
    v.summary,
    ...(actionable.length
      ? [
          "",
          `#### Actionable Findings (${actionable.length})`,
          ...actionable.flatMap((f, idx) => {
            const explanation = String(f.detail || "").split("\n\n@@")[0].trim();
            return [
              "",
              `${idx + 1}. **[${String(f.severity || "low").toUpperCase()}] \`${f.file}${f.line ? `:L${f.line}` : ""}\`** — **${f.title}**`,
              ...(explanation ? [`   ${explanation}`] : []),
              ...(f.suggestion
                ? [
                    "```suggestion",
                    String(f.suggestion).replace(/\r?\n$/, ""),
                    "```",
                  ]
                : []),
            ];
          }),
        ]
      : []),
    ...(resolved.length
      ? [
          "",
          `#### ✅ Resolved since \`${incremental.prevSha.slice(0, 7)}\` (${resolved.length})`,
          ...resolved.map((f) => `- ~~**[${f.severity.toUpperCase()}] \`${f.file}\`**: ${f.title}~~`),
        ]
      : []),
    ...(r.outsideDiffImpact?.callers?.length
      ? [
          "",
          `#### 🌐 Outside-Diff Call Graph Impact (${r.outsideDiffImpact.outsideCallers} caller(s) in ${r.outsideDiffImpact.uniqueFiles} un-modified file(s))`,
          "The following un-modified files in the repository depend on symbols altered in this diff (verified for contract & exception safety):",
          ...r.outsideDiffImpact.callers.slice(0, 5).map((c) => `- \`${c.file}:${c.line}\`: calls \`${c.symbol}()\` — \`${c.snippet.slice(0, 100)}\``),
        ]
      : []),
    "",
    `## [2.5/4] Architecture & Blast Radius Graph`,
    "```mermaid",
    buildBlastMermaid(r),
    "```",
    "",
    `---`,
    `🔗 **[View full review details on CodeOtter →](${appLink})**`,
  ];
  return lines.join("\n");
}
