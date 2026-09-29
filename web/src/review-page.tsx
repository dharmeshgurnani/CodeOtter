import { useEffect, useState } from "react";
import { BookOpen, GitCommitHorizontal, Loader2, RotateCw, ShieldCheck, Sparkles } from "lucide-react";
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
import { type Finding, type Review, VERDICT, effort, tone } from "./types";
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
        <span className="inline-block animate-pulse text-base leading-none select-none" aria-hidden="true">
          🦦
        </span>
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
  <table className="my-1.5 w-full border-collapse text-sm">
    <thead><tr>{head.map((h) => <th key={h} className="border border-border bg-neutral-50 px-2.5 py-1.5 text-left font-semibold">{h}</th>)}</tr></thead>
    <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="border border-border px-2.5 py-1.5 align-top">{c}</td>)}</tr>)}</tbody>
  </table>
);

export const Ring = ({ label, value: raw, invert, loading }: { label: string; value: number; invert?: boolean; loading?: boolean }) => {
  if (loading) {
    return (
      <div className="relative flex size-[88px] flex-col items-center justify-center rounded-full border-[6px] border-neutral-200 bg-white">
        <Loader2 className="size-5 animate-spin text-brand mb-0.5" />
        <span className="relative text-[11px] leading-none text-muted-foreground">{label}</span>
      </div>
    );
  }
  const value = Math.max(0, Math.min(100, Number(raw) || 0));
  const c = { ok: "#15803d", warn: "#b45309", bad: "#b91c1c" }[tone(value, invert)];
  return (
    <div className="relative flex size-[88px] flex-col items-center justify-center rounded-full" style={{ background: `conic-gradient(${c} ${value}%, #e9e9e9 0)` }}>
      <span className="absolute inset-[7px] rounded-full bg-white" />
      <b className="relative text-xl">{value}</b>
      <span className="relative text-[11px] leading-none text-muted-foreground">{label}</span>
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
  const out = [`### ${idx + 1}. [${f.severity.toUpperCase()}] \`${f.file}\``, body];
  if (hunk) {
    out.push("```diff", hunk, "```");
  }
  return out.join("\n");
}

function buildAiReviewMarkdown(r: Review) {
  const { pr: p, review: v, guide, gitHistory, pending } = r;
  const prCommits = gitHistory?.prCommits ?? [];
  const baseCommits = gitHistory?.baseCommits ?? [];
  const lines: string[] = [];

  lines.push(`# CodeOtter Review Session — PR #${p.number}: ${p.title}`);
  lines.push("");
  lines.push(`## [1/4] Pull Request Context & Guidelines`);
  lines.push(`- **Branch**: \`${p.headRefName}\` -> \`${p.baseRefName}\` by @${p.author.login}`);
  lines.push(`- **Scope**: ${p.changedFiles} changed file(s) (+${p.additions} / -${p.deletions})`);
  lines.push(`- **Repository Guidelines**: ${guide ? `Loaded \`${guide}\` and enforced against diff hunks` : "Standard CodeOtter engineering rules"}`);
  if (r.commentsPosted?.length) {
    lines.push(`- **GitHub Sync**: Posted comment(s) to PR (${r.commentsPosted.join(", ")})`);
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

  const actionable = (v.findings || []).filter((f) => f.severity !== "nit");
  const nits = (v.findings || []).filter((f) => f.severity === "nit");

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

  if (v.rawOutput?.trim()) {
    lines.push("");
    lines.push(`## Full Review Stream Log`);
    lines.push("```text");
    lines.push(v.rawOutput.trim());
    lines.push("```");
  }

  return lines.join("\n");
}

export function ReviewPage({ pr, repo: repoHint, force, onDone }: { pr: string; repo: string; force: string; onDone: () => void }) {
  const [r, setR] = useState<Review | null>(null);
  const [err, setErr] = useState("");
  const [animateWrite, setAnimateWrite] = useState(false);
  const [descExpanded, setDescExpanded] = useState(false);
  const [rerunReq, setRerunReq] = useState<{ id: number; part: "scores" | "llm" } | null>(null);
  useEffect(() => {
    setR(null);
    setErr("");
    setAnimateWrite(false);
    setDescExpanded(false);
    setRerunReq(null);
  }, [pr, repoHint]);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const plain = `/review?pr=${encodeURIComponent(pr)}${repoHint ? `&repo=${encodeURIComponent(repoHint)}` : ""}`;
    const poll = async (isFirst: boolean) => {
      try {
        const useForce = isFirst && (!!force || !!rerunReq);
        const partParam = isFirst && rerunReq ? `&part=${rerunReq.part}` : "";
        const res = await fetch(`/api/score?pr=${encodeURIComponent(pr)}${repoHint ? `&repo=${encodeURIComponent(repoHint)}` : ""}${useForce ? "&force=1" : ""}${partParam}&async=1`);
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
  }, [pr, repoHint, force, rerunReq]);

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
    const repoName = p.url.split("/").slice(3, 5).join("/");
    const [vl] = VERDICT[v.verdict] ?? VERDICT.comment;
    const cleanSum = sanitizeSummary(v.summary);
    updateSeo({
      title: `PR #${p.number}: ${p.title} (${repoName}) · CodeOtter`,
      description: `Verdict: ${vl} · Quality ${v.scores?.quality ?? 0}/100 · Blast Radius ${b.score}/100 · ${p.changedFiles} files (+${p.additions}/-${p.deletions})${cleanSum ? ` — ${cleanSum}` : ""}`,
      image: `${location.origin}/og.svg?pr=${encodeURIComponent(p.url)}`,
      type: "article",
    });
  }, [r, pr]);

  if (err) return <pre className="whitespace-pre-wrap rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{err}</pre>;
  if (!r) return <ReviewSkeleton note="Loading pull request metadata…" />;

  const { pr: p, blast: b, review: v0, pending } = r;
  const v = { ...v0, findings: Array.isArray(v0.findings) ? v0.findings : [], walkthrough: Array.isArray(v0.walkthrough) ? v0.walkthrough.filter((w) => w && typeof w.file === "string") : [], scores: Object.assign({ quality: 0, correctness_risk: 0, test_coverage: 0, readability: 0, pr_hygiene: 0 }, v0.scores ?? {}) };
  const [vl, vt] = VERDICT[v.verdict] ?? VERDICT.comment;
  const e = effort(b.score, b.lines);
  const repo = p.url.split("/").slice(3, 5).join("/");
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
          <span>{repo} · {p.author.login} wants to merge <InlineCode>{p.headRefName}</InlineCode> into <InlineCode>{p.baseRefName}</InlineCode></span>
          <span>· {p.changedFiles} files changed <span className="text-green-700">+{p.additions}</span> <span className="text-red-700">-{p.deletions}</span></span>
          {r.guide && (
            <span className="inline-flex items-center gap-1 rounded-md bg-orange-50 border border-orange-200/70 px-2 py-0.5 text-xs font-medium text-orange-900">
              <BookOpen className="size-3" /> Guidelines: {r.guide}
            </span>
          )}
          {prCommits.length > 0 && (
            <span className="inline-flex items-center gap-1 rounded-md bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700">
              <GitCommitHorizontal className="size-3" /> {prCommits.length} commit{prCommits.length === 1 ? "" : "s"} in PR
            </span>
          )}
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
                        <FileItem key={w.file} gitStatus={gitStatus} className="flex flex-wrap items-center justify-between gap-3">
                          <span className="font-mono text-[13px] text-neutral-900">
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

      {/* Side-by-side (30% / 70%): CodeOtter · Scores & Merge Gates + CodeOtter AI Review */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[3fr_7fr] items-stretch">
        {/* CodeOtter Scorecard & Pre-Merge Gates (30%) */}
        <div className="min-w-0 h-[540px] flex flex-col overflow-hidden rounded-[10px] border border-border bg-white">
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
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3.5 text-[15px]">
            <div className="mb-3 flex items-center justify-between rounded-md bg-neutral-100/80 px-3 py-1.5 text-xs text-muted-foreground">
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
              <p className="my-2 text-sm">{b.files} files · {b.lines} lines · {b.dirs} areas · {b.testFiles} test files</p>
              {b.hotspots.length ? b.hotspots.map((h) => <span key={h} className="mr-1.5 inline-block rounded-full bg-orange-100 px-2.5 py-0.5 text-xs text-orange-900">{h}</span>) : <span className="text-sm text-muted-foreground">No hotspots touched.</span>}
            </details>
            <details className="my-2.5"><summary className="cursor-pointer text-sm font-semibold">Pre-merge checks</summary>
              <Md head={["Check", "Status"]} rows={[
                ...(r.gates?.length || pending?.gates ? [] : [["Title check", check(v.scores.pr_hygiene >= 60)], ["Description check", check((p.body ?? "").length > 80)]]),
                ["Tests touched", check(b.testFiles > 0)],
                ...(r.gates ?? []).map((g) => [g.label, <>{check(g.pass)} <span className="text-muted-foreground">({Math.round(g.yes * 100)}% yes)</span></>] as React.ReactNode[]),
                ...(pending?.gates ? [["Merge gates", <InlineLoader key="g" text="Checking policy gates…" />] as React.ReactNode[]] : []),
              ]} />
            </details>
          </div>
        </div>

        {/* Single CodeOtter AI Review Dark Terminal Card (fixed height, inner scrollable rendered markdown) */}
        <AnimateCode
          code={buildAiReviewMarkdown(r)}
          className="min-w-0 h-[540px] flex flex-col overflow-hidden rounded-[10px] border border-border bg-[#0d1117] text-neutral-200"
        >
          <CodeHeader
            icon={Sparkles}
            copyButton={!pending?.narrative}
            action={
              <button
                type="button"
                onClick={() => setRerunReq({ id: Date.now(), part: "llm" })}
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
          <div className="flex-1 min-h-0 overflow-y-auto p-5 bg-[#0d1117]">
            <MarkdownView
              content={buildAiReviewMarkdown(r)}
              variant="dark"
              writing={animateWrite && !pending?.narrative}
              cursor={animateWrite || !!pending?.narrative}
              duration={2400}
            />
          </div>
          {pending?.narrative && (
            <ClaudeThinkingBar guide={r.guide} commitsCount={prCommits.length} />
          )}
        </AnimateCode>
      </div>
    </div>
  );
}
