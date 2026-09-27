import { useEffect, useState } from "react";
import { Pill } from "./App";
import { type Finding, type Review, VERDICT, effort, tone } from "./types";
import { ReviewSkeleton } from "@/components/skeletons";

const KIND: Record<Finding["severity"], [string, string, string]> = {
  high: ["⚠️", "Potential issue", "Major"],
  medium: ["⚠️", "Potential issue", "Minor"],
  low: ["🛠️", "Refactor suggestion", ""],
  nit: ["🧹", "Nitpick", ""],
};
const Code = ({ children }: { children: React.ReactNode }) => <code className="rounded-[5px] bg-neutral-100 px-1.5 py-px font-mono text-[12.5px]">{children}</code>;
const H4 = ({ children }: { children: React.ReactNode }) => <h4 className="mt-5 mb-2 text-[15px] font-semibold first:mt-0">{children}</h4>;

const Comment = ({ verb, when, children }: { verb: string; when: string; children: React.ReactNode }) => (
  <div className="mb-4 rounded-[10px] border border-border">
    <div className="flex items-center gap-2 border-b border-border bg-[#efefef] px-4 py-2 text-sm">
      <span className="inline-block size-5 rounded-full bg-brand" />
      <b className="font-semibold">pr-scorer</b>
      <span className="text-muted-foreground">bot {verb} {when}</span>
    </div>
    <div className="px-5 py-4 text-[15px]">{children}</div>
  </div>
);

const Md = ({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) => (
  <table className="my-1.5 w-full border-collapse text-sm">
    <thead><tr>{head.map((h) => <th key={h} className="border border-border bg-neutral-50 px-2.5 py-1.5 text-left font-semibold">{h}</th>)}</tr></thead>
    <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="border border-border px-2.5 py-1.5 align-top">{c}</td>)}</tr>)}</tbody>
  </table>
);

const Ring = ({ label, value: raw, invert }: { label: string; value: number; invert?: boolean }) => {
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

const FindingCard = ({ f }: { f: Finding }) => {
  const [icon, kind, sev] = KIND[f.severity] ?? KIND.low;
  return (
    <div className="my-2.5 overflow-hidden rounded-lg border border-border">
      <div className="border-b border-border bg-neutral-50 px-3 py-1.5 text-[13px] text-neutral-700"><Code>{f.file}</Code></div>
      <div className="px-3.5 py-3">
        <b className="block">{icon} {kind}{sev && <span className="ml-1.5 text-xs font-medium text-muted-foreground">| 🔴 {sev}</span>}</b>
        <b className="block font-semibold">{f.title}</b>
        <span>{f.detail}</span>
      </div>
    </div>
  );
};

export function ReviewPage({ pr, repo: repoHint, force, onDone }: { pr: string; repo: string; force: string; onDone: () => void }) {
  const [r, setR] = useState<Review | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let alive = true;
    setR(null);
    setErr("");
    const plain = `/review?pr=${encodeURIComponent(pr)}${repoHint ? `&repo=${encodeURIComponent(repoHint)}` : ""}`;
    fetch(`/api/score?pr=${encodeURIComponent(pr)}${repoHint ? `&repo=${encodeURIComponent(repoHint)}` : ""}${force ? "&force=1" : ""}`)
      .then(async (res) => (res.ok ? res.json() : Promise.reject(new Error((await res.json().catch(() => ({}))).error || `${res.status}`))))
      .then((d) => {
        if (!alive) return;
        setR(d);
        onDone();
        // drop force from the URL so a refresh or Back does not pay for another review
        if (force) history.replaceState(null, "", plain);
      })
      .catch((e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [pr, repoHint, force]);

  if (err) return <pre className="whitespace-pre-wrap rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{err}</pre>;
  if (!r) return <ReviewSkeleton note="Reviewing with the model, usually 10 to 30 seconds." />;

  const { pr: p, blast: b, review: v0 } = r;
  // stored reviews from older versions may lack fields; the server normalises new ones
  const v = { ...v0, findings: Array.isArray(v0.findings) ? v0.findings : [], walkthrough: Array.isArray(v0.walkthrough) ? v0.walkthrough.filter((w) => w && typeof w.file === "string") : [], scores: Object.assign({ quality: 0, correctness_risk: 0, test_coverage: 0, readability: 0, pr_hygiene: 0 }, v0.scores ?? {}) };
  const [vl, vt] = VERDICT[v.verdict] ?? VERDICT.comment;
  const e = effort(b.score, b.lines);
  const when = new Date(r.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  const repo = p.url.split("/").slice(3, 5).join("/");
  const cohorts = new Map<string, typeof v.walkthrough>();
  for (const w of v.walkthrough ?? []) {
    const k = w.file.split("/").slice(0, 3).join("/");
    cohorts.set(k, [...(cohorts.get(k) ?? []), w]);
  }
  const actionable = v.findings.filter((f) => f.severity !== "nit");
  const nits = v.findings.filter((f) => f.severity === "nit");
  const check = (ok: boolean) => (ok ? "✅ Passed" : "⚠️ Warning");

  return (
    <>
      <h3 className="mb-2 text-lg font-semibold">{p.title} <Pill tone={vt}>{vl}</Pill></h3>
      <p className="mb-4 text-sm text-muted-foreground">
        {repo} · {p.author.login} wants to merge <Code>{p.headRefName}</Code> into <Code>{p.baseRefName}</Code> · {p.changedFiles} files changed <span className="text-green-700">+{p.additions}</span> <span className="text-red-700">-{p.deletions}</span>
      </p>

      <Comment verb="commented" when={when}>
        <H4>Walkthrough</H4>
        <p>{v.summary}</p>
        <H4>Changes</H4>
        <Md head={["Cohort / File(s)", "Summary"]} rows={[...cohorts].map(([k, ws]) => [
          <><b>{k}</b><br />{ws.map((w) => <Code key={w.file}>{w.file.split("/").pop()}</Code>).reduce<React.ReactNode[]>((a, c) => [...a, " ", c], [])}</>,
          ws.map((w) => <div key={w.file}>{w.change}</div>),
        ])} />
        <H4>Estimated code review effort</H4>
        <p>🎯 {e.n} ({e.label}) | ⏱️ ~{e.mins} minutes</p>
        <H4>Scores</H4>
        <div className="my-1.5 flex flex-wrap gap-4">
          <Ring label="Quality" value={v.scores.quality} />
          <Ring label="Blast radius" value={b.score} invert />
          <Ring label="Risk" value={v.scores.correctness_risk} invert />
          <Ring label="Tests" value={v.scores.test_coverage} />
          <Ring label="Readability" value={v.scores.readability} />
          <Ring label="PR hygiene" value={v.scores.pr_hygiene} />
        </div>
        <details className="my-2"><summary className="cursor-pointer font-semibold">Blast radius details</summary>
          <p className="my-2">{b.files} files · {b.lines} lines · {b.dirs} areas · {b.testFiles} test files</p>
          {b.hotspots.length ? b.hotspots.map((h) => <span key={h} className="mr-1.5 inline-block rounded-full bg-orange-100 px-2.5 py-0.5 text-xs text-orange-900">{h}</span>) : <span className="text-muted-foreground">No hotspots touched.</span>}
        </details>
        <details className="my-2"><summary className="cursor-pointer font-semibold">Pre-merge checks</summary>
          <Md head={["Check", "Status"]} rows={[["Title check", check(v.scores.pr_hygiene >= 60)], ["Description check", check((p.body ?? "").length > 80)], ["Tests touched", check(b.testFiles > 0)], ...(r.gates ?? []).map((g) => [g.label, <>{check(g.pass)} <span className="text-muted-foreground">({Math.round(g.yes * 100)}% yes)</span></>] as React.ReactNode[])]} />
        </details>
        <div className="mt-3.5 flex gap-4 border-t border-border pt-2.5 text-[13px] text-muted-foreground"><span>{r.engines?.s1 && r.engines?.llm ? `Language model ${r.engines.llm} · System One ${r.engines.s1}` : `Model ${r.model}`}</span><span>Reviewed {when}</span></div>
      </Comment>

      <Comment verb="reviewed" when={when}>
        <p className="font-semibold">Actionable comments posted: {actionable.length}</p>
        {actionable.map((f, i) => <FindingCard key={i} f={f} />)}
        {nits.length > 0 && (
          <details open className="my-2"><summary className="cursor-pointer font-semibold">🧹 Nitpick comments ({nits.length})</summary>{nits.map((f, i) => <FindingCard key={i} f={f} />)}</details>
        )}
        <details className="my-2"><summary className="cursor-pointer font-semibold">📜 Review details</summary>
          <p className="my-2"><b>Configuration used:</b> defaults<br /><b>Review profile:</b> ASSERTIVE<br /><b>Files selected for processing ({p.files.length})</b></p>
          <ul className="list-disc pl-6">{p.files.map((f) => <li key={f.path}><Code>{f.path}</Code> <span className="text-muted-foreground">(+{f.additions} -{f.deletions})</span></li>)}</ul>
        </details>
      </Comment>
    </>
  );
}
