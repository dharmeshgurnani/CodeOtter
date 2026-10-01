import { useEffect, useRef, useState } from "react";
import { ArrowDown, BookOpen, GitCommitHorizontal, Loader2, RotateCw, ShieldCheck, Sparkles } from "lucide-react";
import {
  Files,
  FolderItem,
  FolderTrigger,
  FolderContent,
  FileItem,
  SubFiles,
} from "@/components/animate-ui/components/radix/files";
import {
  Code as AnimateCode,
  CodeHeader,
} from "@/components/animate-ui/components/animate/code";
import { MarkdownView } from "@/components/markdown";
import { updateSeo } from "@/lib/seo";
import { Pill } from "./App";
import { type Finding, type Review, repoFromUrl, repoLabel, VERDICT, effort, tone } from "./types";
import { ReviewSkeleton } from "@/components/skeletons";

const InlineCode = ({ children }: { children: React.ReactNode }) => <code className="rounded-[5px] bg-neutral-100 px-1.5 py-px font-mono text-[12.5px]">{children}</code>;
const H4 = ({ children }: { children: React.ReactNode }) => <h4 className="mt-5 mb-2 text-[15px] font-semibold first:mt-0">{children}</h4>;
const InlineLoader = ({ text }: { text: string }) => (
  <span className="inline-flex items-center gap-2 py-1 text-sm text-muted-foreground">
    <Loader2 className="size-3.5 animate-spin text-brand" />
    <span>{text}</span>
  </span>
);

const THINKING_STEPS = [
  "Reading AGENTS.md & CLAUDE.md guidelines…",
  "Inspecting git commit history & branch progression…",
  "Bluping through diff hunks & control flow…",
  "Generating architectural walkthrough…",
  "Cross-checking security & blast radius hotspots…",
  "Synthesizing actionable findings…",
];

function ClaudeThinkingBar({ guide, commitsCount }: { guide?: string | null; commitsCount: number }) {
  const [step, setStep] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t1 = setInterval(() => setStep((s) => (s + 1) % THINKING_STEPS.length), 2200);
    const t2 = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => {
      clearInterval(t1);
      clearInterval(t2);
    };
  }, []);
  return (
    <div className="shrink-0 flex flex-wrap items-center justify-between gap-3 border-t border-neutral-800 bg-[#161b22] px-4 py-2.5 text-xs text-neutral-300">
      <div className="flex items-center gap-2.5">
        <img src="/codeotter-icon.svg" alt="" className="size-5 rounded-sm inline-block animate-pulse select-none shrink-0" aria-hidden="true" />
        <span className="font-mono font-medium text-neutral-100">{THINKING_STEPS[step]}</span>
      </div>
      <div className="flex items-center gap-2 text-neutral-400">
        {guide && <span className="rounded bg-neutral-800/90 border border-neutral-700 px-2 py-0.5 text-neutral-200">📘 {guide}</span>}
        {commitsCount > 0 && <span className="rounded bg-neutral-800/90 border border-neutral-700 px-2 py-0.5 text-neutral-200">🕓 {commitsCount} commit{commitsCount === 1 ? "" : "s"}</span>}
        <span className="font-mono tabular-nums text-amber-400">{elapsed}s</span>
      </div>
    </div>
  );
}

const Md = ({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) => (
  <div className="my-1.5 overflow-x-auto">
    <table className="w-full border-collapse text-sm">
      <thead><tr>{head.map((h) => <th key={h} className="border border-border bg-neutral-50 px-2.5 py-1.5 text-left font-semibold">{h}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="border border-border px-2.5 py-1.5 align-top">{c}</td>)}</tr>)}</tbody>
    </table>
  </div>
);

export const Ring = ({ label, value: raw, invert, loading }: { label: string; value: number; invert?: boolean; loading?: boolean }) => {
  if (loading) {
    return (
      <div className="relative flex size-[78px] sm:size-[88px] flex-col items-center justify-center rounded-full border-[6px] border-neutral-200 bg-white">
        <Loader2 className="size-5 animate-spin text-brand mb-0.5" />
        <span className="relative text-[10px] sm:text-[11px] leading-none text-muted-foreground">{label}</span>
      </div>
    );
  }
  const value = Math.max(0, Math.min(100, Number(raw) || 0));
  const c = { ok: "#15803d", warn: "#b45309", bad: "#b91c1c" }[tone(value, invert)];
  return (
    <div className="relative flex size-[78px] sm:size-[88px] flex-col items-center justify-center rounded-full" style={{ background: `conic-gradient(${c} ${value}%, #e9e9e9 0)` }}>
      <span className="absolute inset-[6px] sm:inset-[7px] rounded-full bg-white" />
      <b className="relative text-lg sm:text-xl">{value}</b>
      <span className="relative text-[10px] sm:text-[11px] leading-none text-muted-foreground">{label}</span>
    </div>
  );
};

function sanitizeSummary(s: string) {
  return String(s || "")
    .replace(/^CodeReviewer\s*\([^)]+\)/i, "CodeOtter")
    .replace(/\s*Calibrated scores and merge gates are evaluated by the System One engine\./i, "")
    .trim();
}

function formatFindingEntry(f: Finding, idx: number) {
  const parts = (f.detail || "").split("\n\n@@");
  const explanation = (parts[0] || f.detail || "").trim();
  const hunk = parts[1] ? `@@${parts[1].trim()}` : "";
  const title = (f.title || "").trim();
  const normTitle = title.replace(/…$/, "").trim().toLowerCase();
  const startsWithTitle = normTitle.length > 0 && explanation.toLowerCase().startsWith(normTitle);
  const body = startsWithTitle ? explanation : title && explanation && title !== explanation ? `**${title}** — ${explanation}` : explanation || title;
  const out = [`### ${idx + 1}. [${f.severity.toUpperCase()}] \`${f.file}${f.line ? `:${f.line}` : ""}\`${f.line ? ` (\`L${f.line}\`)` : ""}`, body];
  if (f.suggestion?.trim()) {
    out.push("```suggestion", f.suggestion.trim(), "```");
  }
  if (hunk) {
    out.push("```diff", hunk, "```");
  }
  return out.join("\n");
}

const HOTSPOT_RULES: [string, RegExp][] = [
  ["migrations", /(^|\/)migrations\//i],
  ["auth / security", /auth|acl|permission|middleware|secret|token/i],
  ["payments / money", /payment|invoice|billing|stripe|fee/i],
  ["public API routes", /(^|\/)(api|routes)\//i],
  ["core domain", /\bcore\//],
  ["dependencies", /package\.json|pnpm-lock\.yaml|yarn\.lock|package-lock\.json|go\.sum|Cargo\.lock/],
  ["CI / deploy", /\.github\/|railway\.json|Dockerfile|docker-compose|\.gitlab-ci/],
];

function cleanMermaidText(s: string, max = 42) {
  const clean = String(s || "")
    .replace(/["[\]`<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export function buildBlastMermaid(r: Review) {
  const { pr: p, blast: b, review: v } = r;
  const files = p.files?.length
    ? p.files
    : (v.walkthrough || []).map((w) => ({ path: w.file, additions: 0, deletions: 0 }));
  const walkMap = new Map<string, string>();
  for (const w of v.walkthrough || []) {
    if (w?.file && w?.change) walkMap.set(w.file, w.change);
  }

  const out: string[] = [
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
    `  PR["PR #${p.number}: ${prHead} -> ${prBase}<br/>${p.changedFiles} file(s) (+${p.additions} / -${p.deletions}) · Blast ${b.score}/100"]:::pr`,
  );

  const cohortMap = new Map<string, typeof files>();
  for (const f of files) {
    const parts = f.path.split("/");
    const key = parts.length > 1 ? parts.slice(0, Math.min(2, parts.length - 1)).join("/") : "(root)";
    cohortMap.set(key, [...(cohortMap.get(key) || []), f]);
  }

  const cohortEntries = [...cohortMap.entries()].slice(0, 6);
  const cohortNodeIds = new Map<string, string>();

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
  const hotspotLinks = new Map<string, Set<string>>();
  for (const h of b.hotspots || []) hotspotLinks.set(h, new Set());

  cohortEntries.forEach(([cohortKey, cFiles]) => {
    const cid = cohortNodeIds.get(cohortKey)!;
    for (const f of cFiles) {
      for (const [hName, re] of HOTSPOT_RULES) {
        if (re.test(f.path)) {
          if (!hotspotLinks.has(hName)) hotspotLinks.set(hName, new Set());
          hotspotLinks.get(hName)!.add(cid);
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

function buildAiReviewMarkdown(r: Review) {
  const { pr: p, review: v, guide, gitHistory, pending, headSha, incremental } = r;
  const prCommits = gitHistory?.prCommits ?? [];
  const baseCommits = gitHistory?.baseCommits ?? [];
  const currentSha = (headSha || p.headSha || prCommits.at(-1)?.sha || "").slice(0, 7);
  const lines: string[] = [];

  lines.push(`# CodeOtter Review Session — PR #${p.number}: ${p.title}`);
  lines.push("");
  lines.push(`## [1/4] Pull Request Context & Guidelines`);
  lines.push(`- **Branch**: \`${p.headRefName}\` -> \`${p.baseRefName}\` by @${p.author.login}${currentSha ? ` (commit \`${currentSha}\`)` : ""}`);
  lines.push(`- **Scope**: ${p.changedFiles} changed file(s) (+${p.additions} / -${p.deletions})`);
  if (incremental) {
    lines.push(
      `- **Incremental Delta**: \`${incremental.prevSha.slice(0, 7)}\` → \`${incremental.headSha.slice(0, 7)}\` (${incremental.newCommits.length} new commit${incremental.newCommits.length === 1 ? "" : "s"})${incremental.resolvedFindings?.length ? ` · ✅ ${incremental.resolvedFindings.length} prior finding(s) resolved` : ""}`,
    );
    if (incremental.newCommits.length > 0) {
      lines.push(
        `  - **New Commits**: ${incremental.newCommits.map((cm) => `\`${cm.sha.slice(0, 7)}\` ${cm.message}`).join(" · ")}`,
      );
    }
  }
  lines.push(`- **Repository Guidelines**: ${guide ? `Loaded \`${guide}\` and enforced against diff hunks` : "Standard CodeOtter engineering rules"}`);
  if (r.learnings?.length) {
    lines.push(
      `- **Team Learnings Enforced (${r.learnings.length})**: ${r.learnings.map((l) => `\`${l}\``).join(" · ")}`,
    );
  }
  if (r.linkedIssues?.length) {
    lines.push(
      `- **Linked Issues (${r.linkedIssues.length})**: ${r.linkedIssues
        .map((i) => `[#${i.number} ${i.title}](${i.url})${i.state ? ` (${i.state})` : ""}`)
        .join(" · ")}`,
    );
    for (const iss of r.linkedIssues) {
      const reqText = (iss.body || "").trim().replace(/\s+/g, " ").slice(0, 280);
      if (reqText) {
        lines.push(`  - **#${iss.number} Requirements**: ${reqText}${(iss.body || "").trim().length > 280 ? "…" : ""}`);
      }
    }
  }
  if (r.commentsPosted?.length) {
    lines.push(`- **PR Sync**: Posted comment(s) to PR (${r.commentsPosted.join(", ")})`);
  }

  lines.push("");
  lines.push(`## [2/4] Git Commit History Inspected (${prCommits.length} PR commit${prCommits.length === 1 ? "" : "s"})`);
  if (prCommits.length) {
    for (const cm of prCommits.slice(0, 12)) {
      lines.push(`- \`${cm.sha}\` ${cm.message}${cm.author ? ` (${cm.author})` : ""}`);
    }
  } else {
    lines.push(`- Inspecting branch diff against \`${p.baseRefName}\``);
  }
  if (baseCommits.length) {
    lines.push(`- **Recent \`${p.baseRefName}\` history**: ${baseCommits.slice(0, 4).map((c) => `\`${c.sha}\` ${c.message}`).join(" · ")}`);
  }

  lines.push("");
  lines.push(`## [2.5/4] Architecture & Blast Radius Graph`);
  lines.push("```mermaid");
  lines.push(buildBlastMermaid(r));
  lines.push("```");

  if (r.outsideDiffImpact?.callers?.length) {
    lines.push("");
    lines.push(`### 🌐 Outside-Diff Call Graph Impact (${r.outsideDiffImpact.outsideCallers} caller(s) in ${r.outsideDiffImpact.uniqueFiles} un-modified file(s))`);
    lines.push("The following un-modified files in the repository depend on symbols altered in this diff (verified for contract & exception safety):");
    for (const c of r.outsideDiffImpact.callers.slice(0, 5)) {
      lines.push(`- \`${c.file}:${c.line}\`: calls \`${c.symbol}()\` — \`${c.snippet.slice(0, 100)}\``);
    }
  }

  const walkthrough = v.walkthrough?.length
    ? v.walkthrough
    : p.files.map((f) => ({ file: f.path, change: `+${f.additions} / -${f.deletions}` }));
  if (walkthrough.length) {
    lines.push("");
    lines.push(`## [3/4] File-by-File Walkthrough (${walkthrough.length} file${walkthrough.length === 1 ? "" : "s"})`);
    for (const w of walkthrough) {
      lines.push(`- \`${w.file}\` — ${w.change || "Queued for hunk inspection…"}`);
    }
  }

  lines.push("");
  lines.push(`## [4/4] CodeOtter Review Output & Findings`);
  const summary = sanitizeSummary(v.summary);
  if (summary) {
    lines.push(summary);
  } else if (pending?.narrative) {
    lines.push(`_Streaming hunk-by-hunk analysis against ${guide || "repository rules"}…_`);
  } else {
    lines.push(`Completed review across ${p.changedFiles} changed file(s).`);
  }

  if (incremental?.resolvedFindings?.length) {
    lines.push("");
    lines.push(`## ✅ Resolved since \`${incremental.prevSha.slice(0, 7)}\` (${incremental.resolvedFindings.length})`);
    for (const rf of incremental.resolvedFindings) {
      lines.push(`- ~~**[${rf.severity.toUpperCase()}] \`${rf.file}\`**: ${rf.title}~~`);
    }
  }

  const activeFindings = (v.findings || []).filter((f) => !f.dismissed);
  const dismissedFindings = (v.findings || []).filter((f) => f.dismissed);
  const actionable = activeFindings.filter((f) => f.severity !== "nit");
  const nits = activeFindings.filter((f) => f.severity === "nit");

  if (actionable.length) {
    lines.push("");
    lines.push(`## Actionable Findings (${actionable.length})`);
    actionable.forEach((f, i) => {
      lines.push("");
      lines.push(formatFindingEntry(f, i));
    });
  } else if (!pending?.narrative) {
    lines.push("");
    lines.push(`✅ No blocking issues detected across ${p.changedFiles} changed file(s).`);
  }

  if (nits.length) {
    lines.push("");
    lines.push(`## Nitpicks (${nits.length})`);
    nits.forEach((f, i) => {
      lines.push("");
      lines.push(formatFindingEntry(f, i));
    });
  }

  if (dismissedFindings.length) {
    lines.push("");
    lines.push(`_🧠 ${dismissedFindings.length} finding(s) dismissed and remembered as persistent repository team learning(s)._`);
  }

  if (v.rawOutput?.trim()) {
    lines.push("");
    lines.push(`## Full Review Stream Log`);
    lines.push("```text");
    lines.push(v.rawOutput.trim());
    lines.push("```");
  }

  return lines.join("\n");
}

export function ReviewPage({ forgeUrls = {}, org = "", pr, repo: repoHint, force, onDone }: { forgeUrls?: Record<string, string>; org?: string; pr: string; repo: string; force: string; onDone: () => void }) {
  const [r, setR] = useState<Review | null>(null);
  const [err, setErr] = useState("");
  const [animateWrite, setAnimateWrite] = useState(false);
  const [descExpanded, setDescExpanded] = useState(false);
  const [rerunReq, setRerunReq] = useState<{ id: number; part: "scores" | "llm" | "all" } | null>(null);
  const [dismissingKey, setDismissingKey] = useState<string>("");
  const [learningNotice, setLearningNotice] = useState<string>("");
  const [copiedFixKey, setCopiedFixKey] = useState<string>("");
  const [postingSuggestionKey, setPostingSuggestionKey] = useState<string>("");
  const [postedSuggestionKeys, setPostedSuggestionKeys] = useState<Record<string, boolean>>({});
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const terminalScrollRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);

  const scrollToBottom = (smooth = true) => {
    userScrolledUpRef.current = false;
    setShowScrollBottom(false);
    if (terminalScrollRef.current) {
      terminalScrollRef.current.scrollTo({
        top: terminalScrollRef.current.scrollHeight,
        behavior: smooth ? "smooth" : "auto",
      });
    }
  };

  const handleTerminalScroll = () => {
    const el = terminalScrollRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const isUp = distanceToBottom > 48;
    userScrolledUpRef.current = isUp;
    setShowScrollBottom(isUp);
  };

  const handleMarkdownUpdate = () => {
    if (!userScrolledUpRef.current && terminalScrollRef.current) {
      terminalScrollRef.current.scrollTop = terminalScrollRef.current.scrollHeight;
    }
  };

  useEffect(() => {
    if (!userScrolledUpRef.current && terminalScrollRef.current) {
      terminalScrollRef.current.scrollTop = terminalScrollRef.current.scrollHeight;
    }
  }, [r, r?.pending?.narrative]);

  useEffect(() => {
    setR(null);
    setErr("");
    setAnimateWrite(false);
    setDescExpanded(false);
    setRerunReq(null);
    setDismissingKey("");
    setLearningNotice("");
    setCopiedFixKey("");
    setPostingSuggestionKey("");
    setPostedSuggestionKeys({});
    setShowScrollBottom(false);
    userScrolledUpRef.current = false;
  }, [pr, repoHint, org]);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const plain = `/review?pr=${encodeURIComponent(pr)}${repoHint ? `&repo=${encodeURIComponent(repoHint)}` : ""}`;
    const poll = async (isFirst: boolean) => {
      try {
        const useForce = isFirst && (!!force || !!rerunReq);
        const partParam = isFirst && rerunReq && rerunReq.part !== "all" ? `&part=${rerunReq.part}` : "";
        const res = await fetch(`/api/score?org=${encodeURIComponent(org)}&pr=${encodeURIComponent(pr)}${repoHint ? `&repo=${encodeURIComponent(repoHint)}` : ""}${useForce ? "&force=1" : ""}${partParam}&async=1`);
        const d = await res.json().catch(() => ({ error: `${res.status}` }));
        if (!res.ok || d.error) throw new Error(d.error || `${res.status}`);
        if (!alive) return;
        if (d.pending?.narrative) setAnimateWrite(true);
        setR((prev) => {
          if (!prev) return d;
          const hasScores = (s?: Record<string, number>) => !!s && Object.values(s).some((v) => Number(v) > 0);
          if (!hasScores(d.review?.scores) && hasScores(prev.review?.scores)) {
            return {
              ...d,
              blast: d.blast?.score ? d.blast : prev.blast,
              gates: d.gates?.length ? d.gates : prev.gates,
              review: { ...d.review, scores: prev.review.scores },
            };
          }
          return d;
        });
        if (isFirst && force) history.replaceState(null, "", plain);
        if (d.pending) {
          timer = setTimeout(() => poll(false), 1000);
        } else {
          onDone();
        }
      } catch (e) {
        if (alive) setErr((e as Error).message);
      }
    };
    poll(true);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [pr, repoHint, force, rerunReq, org]);

  useEffect(() => {
    if (!r) {
      const prNum = pr.split("/").pop() || pr;
      updateSeo({
        title: `PR #${prNum} Review · CodeOtter`,
        description: `Reviewing pull request #${prNum} on CodeOtter.`,
      });
      return;
    }
    const { pr: p, blast: b, review: v } = r;
    const repoName = repoLabel(repoFromUrl(p.url, forgeUrls));
    const [vl] = VERDICT[v.verdict] ?? VERDICT.comment;
    const cleanSum = sanitizeSummary(v.summary);
    updateSeo({
      title: `PR #${p.number}: ${p.title} (${repoName}) · CodeOtter`,
      description: `Verdict: ${vl} · Quality ${v.scores?.quality ?? 0}/100 · Blast Radius ${b.score}/100 · ${p.changedFiles} files (+${p.additions}/-${p.deletions})${cleanSum ? ` — ${cleanSum}` : ""}`,
      image: `${location.origin}/og.svg?pr=${encodeURIComponent(p.url)}`,
      type: "article",
    });
  }, [r, pr, forgeUrls]);

  if (err) return <pre className="whitespace-pre-wrap rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{err}</pre>;
  if (!r) return <ReviewSkeleton note="Loading pull request metadata…" />;

  const { pr: p, blast: b, review: v0, pending } = r;
  const v = { ...v0, findings: Array.isArray(v0.findings) ? v0.findings : [], walkthrough: Array.isArray(v0.walkthrough) ? v0.walkthrough.filter((w) => w && typeof w.file === "string") : [], scores: Object.assign({ quality: 0, correctness_risk: 0, test_coverage: 0, readability: 0, pr_hygiene: 0 }, v0.scores ?? {}) };
  const [vl, vt] = VERDICT[v.verdict] ?? VERDICT.comment;
  const e = effort(b.score, b.lines);
  const repo = repoFromUrl(p.url, forgeUrls);
  const walkthroughList = v.walkthrough.length
    ? v.walkthrough
    : pending?.narrative
      ? p.files.map((f) => ({ file: f.path, change: "" }))
      : [];
  const cohorts = new Map<string, typeof walkthroughList>();
  for (const w of walkthroughList) {
    const k = w.file.split("/").slice(0, 3).join("/");
    cohorts.set(k, [...(cohorts.get(k) ?? []), w]);
  }
  const check = (ok: boolean) => (ok ? "✅ Passed" : "⚠️ Warning");
  const isScoreLoading = (key: string) => !!(pending?.scores && pending?.readyScores?.[key] === undefined);
  const prCommits = r.gitHistory?.prCommits ?? [];
  const bodyText = (p.body || "").trim();
  const isLongDesc = bodyText.length > 240 || bodyText.split("\n").length > 4;
  const activeFindings = v.findings.filter((f) => !f.dismissed);
  const activeLearnings = r.learnings ?? [];

  const handleDismissFinding = async (f: Finding, idx: number) => {
    const fKey = `${idx}:${f.file}:${f.title}`;
    setDismissingKey(fKey);
    setLearningNotice("");
    const rule = `[${f.file}] Ignore pattern: ${f.title || (f.detail || "").split("\n")[0].slice(0, 80)}`;
    try {
      const res = await fetch(`/api/learnings?org=${encodeURIComponent(org)}`,  {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prUrl: p.url,
          repo,
          file: f.file,
          title: f.title,
          detail: f.detail,
          rule,
        }),
      });
      const d = await res.json().catch(() => ({ error: `${res.status}` }));
      if (!res.ok || d.error) throw new Error(d.error || `${res.status}`);
      setR((prev) => {
        if (!prev) return prev;
        const nextFindings = (prev.review.findings || []).map((item, i) =>
          i === idx || (item.file === f.file && item.title === f.title && !item.dismissed)
            ? { ...item, dismissed: true }
            : item,
        );
        return {
          ...prev,
          learnings: Array.isArray(d.learnings) ? d.learnings : [...(prev.learnings || []), rule],
          review: {
            ...prev.review,
            findings: nextFindings,
          },
        };
      });
      setLearningNotice(`Saved rule to ${repo}: ${rule}`);
    } catch (e) {
      setLearningNotice(`Could not save learning: ${(e as Error).message}`);
    } finally {
      setDismissingKey("");
    }
  };

  const handleCopySuggestion = (fKey: string, suggestion: string) => {
    try {
      navigator.clipboard?.writeText(suggestion);
      setCopiedFixKey(fKey);
      setTimeout(() => setCopiedFixKey((cur) => (cur === fKey ? "" : cur)), 1800);
    } catch {}
  };

  const handlePostSuggestion = async (f: Finding, idx: number) => {
    const fKey = `${idx}:${f.file}:${f.title}`;
    setPostingSuggestionKey(fKey);
    setLearningNotice("");
    try {
      const res = await fetch(`/api/review-suggestions?org=${encodeURIComponent(org)}`,  {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prUrl: p.url,
          repo,
          findingIdx: idx,
          file: f.file,
          line: f.line,
          severity: f.severity,
          title: f.title,
          detail: f.detail,
          suggestion: f.suggestion,
        }),
      });
      const d = await res.json().catch(() => ({ error: `${res.status}` }));
      if (!res.ok || d.error) throw new Error(d.error || `${res.status}`);
      setPostedSuggestionKeys((prev) => ({ ...prev, [fKey]: true }));
      const lineTag = f.line ? `:L${f.line}` : "";
      setLearningNotice(`Posted inline committable suggestion for ${f.file}${lineTag} to PR #${p.number}.`);
    } catch (e) {
      setLearningNotice(`Could not post inline suggestion: ${(e as Error).message}`);
    } finally {
      setPostingSuggestionKey("");
    }
  };

  const reviewedSha = (r.headSha || p.headSha || prCommits.at(-1)?.sha || "").slice(0, 7);

  return (
    <div className="space-y-5">
      <div>
        <h3 className="mb-2 text-lg font-semibold flex items-center gap-2 flex-wrap">
          <span>#{p.number} {p.title}</span>
          {pending?.narrative && pending?.scores ? (
            <Pill><span className="inline-flex items-center gap-1.5"><Loader2 className="size-3 animate-spin text-brand" /> Reviewing in progress…</span></Pill>
          ) : (
            <Pill tone={vt}>{vl}</Pill>
          )}
        </h3>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted-foreground">
          <span>{repoLabel(repo)} · {p.author.login} wants to merge <InlineCode>{p.headRefName}</InlineCode> into <InlineCode>{p.baseRefName}</InlineCode></span>
          <span>· {p.changedFiles} files changed <span className="text-green-700">+{p.additions}</span> <span className="text-red-700">-{p.deletions}</span></span>
          {r.incremental ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 border border-emerald-200/80 px-2 py-0.5 text-xs font-medium text-emerald-900">
              <span>
                ⚡ Incremental delta: <code className="font-mono">{r.incremental.prevSha.slice(0, 7)}</code> → <code className="font-mono">{r.incremental.headSha.slice(0, 7)}</code> ({r.incremental.newCommits.length} new commit{r.incremental.newCommits.length === 1 ? "" : "s"}){r.incremental.resolvedFindings?.length ? ` · ✅ ${r.incremental.resolvedFindings.length} resolved` : ""}
              </span>
            </span>
          ) : reviewedSha ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-neutral-100 border border-neutral-200/80 px-2 py-0.5 text-xs font-medium text-neutral-800">
              <span>commit <code className="font-mono">{reviewedSha}</code></span>
            </span>
          ) : null}
          {r.guide && (
            <span className="inline-flex items-center gap-1 rounded-md bg-orange-50 border border-orange-200/70 px-2 py-0.5 text-xs font-medium text-orange-900">
              <BookOpen className="size-3" /> Guidelines: {r.guide}
            </span>
          )}
          {activeLearnings.length > 0 && (
            <span
              title={activeLearnings.join("\n")}
              className="inline-flex items-center gap-1 rounded-md bg-purple-50 border border-purple-200/80 px-2 py-0.5 text-xs font-medium text-purple-900"
            >
              <span>🧠 {activeLearnings.length} team learning{activeLearnings.length === 1 ? "" : "s"} active</span>
            </span>
          )}
          {prCommits.length > 0 && (
            <span className="inline-flex items-center gap-1 rounded-md bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700">
              <GitCommitHorizontal className="size-3" /> {prCommits.length} commit{prCommits.length === 1 ? "" : "s"} in PR
            </span>
          )}
          {(r.linkedIssues ?? []).map((iss) => (
            <a
              key={`${iss.repo || repo}#${iss.number}`}
              href={iss.url}
              target="_blank"
              rel="noreferrer"
              title={iss.body ? `#${iss.number} ${iss.title}\n\n${iss.body.slice(0, 300)}` : `#${iss.number} ${iss.title}`}
              className="inline-flex items-center gap-1 rounded-md bg-blue-50 border border-blue-200/80 px-2 py-0.5 text-xs font-medium text-blue-900 hover:bg-blue-100/80 hover:underline"
            >
              <span>#{iss.number}</span>
              <span className="max-w-[220px] truncate">{iss.title}</span>
            </a>
          ))}
          <button
            type="button"
            disabled={!!(pending?.scores || pending?.narrative)}
            onClick={() => {
              userScrolledUpRef.current = false;
              setShowScrollBottom(false);
              setAnimateWrite(true);
              setRerunReq({ id: Date.now(), part: "all" });
            }}
            title="Re-run incremental delta review against latest PR commits"
            className="inline-flex items-center gap-1 rounded-md border border-amber-300/80 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900 hover:bg-amber-100/80 disabled:opacity-50"
          >
            <RotateCw className={`size-3 ${pending?.scores || pending?.narrative ? "animate-spin text-brand" : ""}`} />
            <span>Re-run delta review</span>
          </button>
        </div>

        {bodyText && (
          <div className="mt-3 rounded-[10px] border border-border bg-neutral-50/60 px-4 py-3 text-sm">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Description</div>
            <div className={!descExpanded && isLongDesc ? "relative max-h-24 overflow-hidden" : ""}>
              <MarkdownView content={bodyText} variant="light" />
              {!descExpanded && isLongDesc && (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-[#fafafa] to-transparent" />
              )}
            </div>
            {isLongDesc && (
              <button
                type="button"
                onClick={() => setDescExpanded((x) => !x)}
                className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline"
              >
                {descExpanded ? "Show less" : "Read more"}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Changes File Tree (Animate UI Radix Files) */}
      <div>
        <H4>Changes ({p.changedFiles} {p.changedFiles === 1 ? "file" : "files"})</H4>
        <div className="my-1.5 rounded-[10px] border border-border bg-white">
          <Files defaultOpen={[]}>
            {[...cohorts].map(([k, ws]) => (
              <FolderItem key={k} value={k}>
                <FolderTrigger className="font-semibold text-neutral-800">
                  {k} <span className="ml-1.5 text-xs font-normal text-muted-foreground">({ws.length} {ws.length === 1 ? "file" : "files"})</span>
                </FolderTrigger>
                <FolderContent>
                  <SubFiles>
                    {ws.map((w) => {
                      const pf = p.files.find((f) => f.path === w.file);
                      const gitStatus = pf ? (pf.deletions === 0 && pf.additions > 0 ? "untracked" : pf.additions === 0 && pf.deletions > 0 ? "deleted" : "modified") : "modified";
                      return (
                        <FileItem key={w.file} gitStatus={gitStatus} className="flex flex-wrap items-center justify-between gap-2">
                          <span className="min-w-0 break-all font-mono text-[13px] text-neutral-900 sm:break-normal">
                            {w.file.split("/").pop()}
                            {pf && (
                              <span className="ml-2 font-sans text-xs">
                                <span className="text-green-700">+{pf.additions}</span> <span className="text-red-700">-{pf.deletions}</span>
                              </span>
                            )}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {pending?.narrative && !v.walkthrough.length ? <InlineLoader text="Summarizing…" /> : w.change}
                          </span>
                        </FileItem>
                      );
                    })}
                  </SubFiles>
                </FolderContent>
              </FolderItem>
            ))}
          </Files>
        </div>
      </div>

      {/* Actionable Findings & Learnings Interactive Bar */}
      {(v.findings.length > 0 || activeLearnings.length > 0) && (
        <div className="rounded-[10px] border border-border bg-white overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-[#efefef] px-4 py-2.5 text-sm">
            <div className="flex items-center gap-2">
              <span aria-hidden="true">🧠</span>
              <b className="font-semibold text-neutral-900">Actionable Findings & Team Learnings</b>
              <span className="rounded-md bg-neutral-200/90 px-2 py-0.5 text-xs font-medium text-neutral-800">
                {activeFindings.length} active finding{activeFindings.length === 1 ? "" : "s"}
              </span>
              {activeLearnings.length > 0 && (
                <span className="rounded-md bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-900">
                  {activeLearnings.length} persistent rule{activeLearnings.length === 1 ? "" : "s"}
                </span>
              )}
            </div>
            <a href="/settings/repos" className="text-xs font-medium text-brand hover:underline">
              Manage rules in Settings →
            </a>
          </div>

          {learningNotice && (
            <div className="border-b border-purple-200 bg-purple-50/70 px-4 py-2 text-xs text-purple-900">
              {learningNotice}
            </div>
          )}

          {activeFindings.length > 0 ? (
            <ul className="divide-y divide-border">
              {v.findings.map((f, idx) => {
                if (f.dismissed) return null;
                const fKey = `${idx}:${f.file}:${f.title}`;
                const busy = dismissingKey === fKey;
                const postingSug = postingSuggestionKey === fKey;
                const postedSug = !!postedSuggestionKeys[fKey];
                const copiedFix = copiedFixKey === fKey;
                const sevTone = f.severity === "high" ? "bg-red-100 text-red-900" : f.severity === "medium" ? "bg-amber-100 text-amber-900" : f.severity === "low" ? "bg-blue-100 text-blue-900" : "bg-neutral-100 text-neutral-700";
                return (
                  <li key={fKey} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-2.5 text-sm">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase ${sevTone}`}>
                          {f.severity}
                        </span>
                        <InlineCode>{f.file}</InlineCode>
                        {f.line ? (
                          <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-emerald-900">
                            L{f.line}
                          </span>
                        ) : null}
                        <span className="font-medium text-neutral-900">{f.title}</span>
                      </div>
                      {f.detail && (
                        <p className="truncate text-xs text-muted-foreground">
                          {f.detail.split("\n\n@@")[0]?.replace(/\s+/g, " ").trim()}
                        </p>
                      )}
                      {f.suggestion && (
                        <div className="rounded border border-emerald-200 bg-emerald-50/70 px-2 py-1 font-mono text-[11.5px] text-emerald-900">
                          <span className="select-none pr-1.5 font-bold text-emerald-600">+</span>
                          <span className="break-all">{f.suggestion.split("\n")[0]}</span>
                        </div>
                      )}
                    </div>
                    <div className="shrink-0 flex flex-wrap items-center gap-1.5">
                      {f.suggestion && (
                        <button
                          type="button"
                          onClick={() => handleCopySuggestion(fKey, f.suggestion!)}
                          className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-900 hover:bg-emerald-100"
                        >
                          <span>{copiedFix ? "✓ Copied fix" : "Copy fix"}</span>
                        </button>
                      )}
                      {(f.suggestion || f.file) && (
                        <button
                          type="button"
                          disabled={postingSug || postedSug}
                          onClick={() => handlePostSuggestion(f, idx)}
                          className="inline-flex items-center gap-1 rounded-md border border-sky-300 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-900 hover:bg-sky-100 disabled:opacity-60"
                        >
                          {postingSug ? (
                            <>
                              <Loader2 className="size-3 animate-spin text-sky-700" />
                              <span>Posting to PR…</span>
                            </>
                          ) : postedSug ? (
                            <span>✓ Posted to PR</span>
                          ) : (
                            <span>Post inline suggestion</span>
                          )}
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleDismissFinding(f, idx)}
                        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-neutral-50 px-2.5 py-1 text-xs font-medium text-neutral-800 hover:bg-purple-50 hover:border-purple-300 hover:text-purple-900 disabled:opacity-50"
                      >
                        {busy ? (
                          <>
                            <Loader2 className="size-3 animate-spin text-brand" />
                            <span>Saving rule…</span>
                          </>
                        ) : (
                          <>
                            <span>Dismiss & remember rule</span>
                          </>
                        )}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="px-4 py-2.5 text-xs text-muted-foreground">
              All findings in this review have been addressed or dismissed as persistent team learnings.
            </div>
          )}

          {activeLearnings.length > 0 && (
            <details className="border-t border-border bg-neutral-50/60 px-4 py-2 text-xs">
              <summary className="cursor-pointer font-medium text-neutral-700">
                Enforced repository learnings ({activeLearnings.length})
              </summary>
              <ul className="mt-1.5 space-y-1 pl-4 list-disc text-muted-foreground font-mono">
                {activeLearnings.map((rule, i) => (
                  <li key={`${i}-${rule}`}>{rule}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {/* Side-by-side (30% / 70%): CodeOtter · Scores & Merge Gates + CodeOtter AI Review */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[3fr_7fr] items-stretch">
        {/* CodeOtter Scorecard & Pre-Merge Gates (30%) */}
        <div className="min-w-0 h-auto lg:h-[540px] flex flex-col overflow-hidden rounded-[10px] border border-border bg-white">
          <div className="shrink-0 flex items-center justify-between gap-2 border-b border-border bg-[#efefef] px-4 py-2.5 text-sm">
            <div className="flex min-w-0 items-center gap-2">
              <ShieldCheck className="size-4 shrink-0 text-brand" />
              <b className="truncate font-semibold">CodeOtter · Scores & Merge Gates</b>
            </div>
            <button
              type="button"
              onClick={() => setRerunReq({ id: Date.now(), part: "scores" })}
              disabled={!!pending?.scores}
              title="Re-run scores & merge gates"
              aria-label="Re-run scores & merge gates"
              className="-mr-1.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-neutral-600 hover:bg-neutral-200/80 hover:text-neutral-900 disabled:opacity-50"
            >
              <RotateCw className={`size-3.5 ${pending?.scores ? "animate-spin text-brand" : ""}`} />
            </button>
          </div>
          <div className="flex-1 min-h-0 lg:overflow-y-auto px-4 py-3.5 text-[15px]">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-1 rounded-md bg-neutral-100/80 px-3 py-1.5 text-xs text-muted-foreground">
              <span>Review effort</span>
              <span className="font-medium text-neutral-800">
                {isScoreLoading("blast_radius") && r.engines?.s1 ? "Calculating effort…" : `🎯 Effort ${e.n} (${e.label}) · ⏱️ ~${e.mins} min`}
              </span>
            </div>
            <div className="my-1.5 grid grid-cols-3 gap-x-2 gap-y-3.5 justify-items-center">
              <Ring label="Quality" value={v.scores.quality} loading={isScoreLoading("quality")} />
              <Ring label="Blast radius" value={b.score} invert loading={isScoreLoading("blast_radius")} />
              <Ring label="Risk" value={v.scores.correctness_risk} invert loading={isScoreLoading("correctness_risk")} />
              <Ring label="Tests" value={v.scores.test_coverage} loading={isScoreLoading("test_coverage")} />
              <Ring label="Readability" value={v.scores.readability} loading={isScoreLoading("readability")} />
              <Ring label="PR hygiene" value={v.scores.pr_hygiene} loading={isScoreLoading("pr_hygiene")} />
            </div>
            <details className="my-3"><summary className="cursor-pointer text-sm font-semibold">Blast radius details</summary>
              <p className="my-2 text-sm">
                {b.files} files · {b.lines} lines · {b.dirs} areas · {b.testFiles} test files
                {b.outsideCallers ? ` · 🌐 ${b.outsideCallers} outside caller(s) across ${b.outsideFiles || 1} un-modified file(s)` : ""}
              </p>
              {b.hotspots.length ? b.hotspots.map((h) => <span key={h} className="mr-1.5 inline-block rounded-full bg-orange-100 px-2.5 py-0.5 text-xs text-orange-900">{h}</span>) : <span className="text-sm text-muted-foreground">No hotspots touched.</span>}
            </details>
            <details className="my-2.5"><summary className="cursor-pointer text-sm font-semibold">Pre-merge checks</summary>
              <Md head={["Check", "Status"]} rows={[
                ...(r.gates?.length || pending?.gates ? [] : [["Title check", check(v.scores.pr_hygiene >= 60)], ["Description check", check((p.body ?? "").length > 80)]]),
                ["Tests touched", check(b.testFiles > 0)],
                ...(r.linkedIssues?.length && !(r.gates ?? []).some((g) => g.id === "issue_requirements")
                  ? [[
                      "Issue requirements",
                      <>{check(v.verdict !== "request_changes" && v.scores.quality >= 60)} <span className="text-muted-foreground">({r.linkedIssues.map((i) => `#${i.number}`).join(", ")})</span></>,
                    ] as React.ReactNode[]]
                  : []),
                ...(r.gates ?? []).map((g) => [
                  g.label,
                  <>{check(g.pass)} <span className="text-muted-foreground">({Math.round(g.yes * 100)}% yes{g.id === "issue_requirements" && r.linkedIssues?.length ? ` · ${r.linkedIssues.map((i) => `#${i.number}`).join(", ")}` : ""})</span></>,
                ] as React.ReactNode[]),
                ...(pending?.gates ? [["Merge gates", <InlineLoader key="g" text="Checking policy gates…" />] as React.ReactNode[]] : []),
              ]} />
            </details>
          </div>
        </div>

        {/* Single CodeOtter AI Review Dark Terminal Card (fixed height, inner scrollable rendered markdown) */}
        <AnimateCode
          code={buildAiReviewMarkdown(r)}
          className="relative min-w-0 max-h-[75vh] min-h-[380px] lg:max-h-none lg:h-[540px] flex flex-col overflow-hidden rounded-[10px] border border-border bg-[#0d1117] text-neutral-200 group"
        >
          <CodeHeader
            icon={Sparkles}
            copyButton={!pending?.narrative}
            action={
              <button
                type="button"
                onClick={() => {
                  userScrolledUpRef.current = false;
                  setShowScrollBottom(false);
                  setAnimateWrite(true);
                  setRerunReq({ id: Date.now(), part: "llm" });
                }}
                disabled={!!pending?.narrative}
                title="Re-run AI review"
                aria-label="Re-run AI review"
                className="inline-flex size-7 items-center justify-center rounded-md text-neutral-600 hover:bg-neutral-200/80 hover:text-neutral-900 disabled:opacity-50"
              >
                <RotateCw className={`size-3.5 ${pending?.narrative ? "animate-spin text-brand" : ""}`} />
              </button>
            }
            className="shrink-0 h-auto border-b border-border bg-[#efefef] px-4 py-2.5 text-sm text-neutral-900 [&_svg]:size-4 [&_svg]:text-brand [&_button]:text-neutral-600 [&_button:hover]:bg-neutral-200/80"
          >
            <b className="font-semibold text-neutral-900">CodeOtter AI Review</b>
          </CodeHeader>
          <div
            ref={terminalScrollRef}
            onScroll={handleTerminalScroll}
            className="flex-1 min-h-0 overflow-y-auto p-3.5 sm:p-5 bg-[#0d1117] scroll-smooth"
          >
            <MarkdownView
              content={buildAiReviewMarkdown(r)}
              variant="dark"
              writing={animateWrite && !pending?.narrative}
              cursor={animateWrite || !!pending?.narrative}
              duration={2400}
              onUpdate={handleMarkdownUpdate}
            />
          </div>
          {showScrollBottom && (
            <button
              type="button"
              onClick={() => scrollToBottom(true)}
              className="absolute bottom-12 right-4 z-20 inline-flex items-center gap-1.5 rounded-full border border-neutral-700 bg-neutral-900/95 px-3 py-1 text-xs font-medium text-amber-400 shadow-xl backdrop-blur transition-all hover:bg-neutral-800 hover:border-neutral-600 active:scale-95"
              aria-label="Scroll to bottom of review"
            >
              <ArrowDown className="size-3.5 text-amber-400 animate-bounce" />
              <span>Scroll to bottom</span>
            </button>
          )}
          {pending?.narrative && (
            <ClaudeThinkingBar guide={r.guide} commitsCount={prCommits.length} />
          )}
        </AnimateCode>
      </div>
    </div>
  );
}
