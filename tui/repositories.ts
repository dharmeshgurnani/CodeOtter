import { setTimeout as delay } from "node:timers/promises";
import { text } from "./review-output.ts";
import { repoFromUrl } from "../core/forges.ts";
import type { PullRequest as CorePullRequest } from "../core/forges.ts";

// Stored review records as the TUI reads them; every model field is untrusted and rendered through text().
export type PullRequest = Pick<CorePullRequest, "number" | "title" | "url">;
export type ReviewGate = { label: string; pass: boolean; explanation?: string };
export type ReviewFinding = { severity: string; title: string; file: string; line?: number | null; detail: string; suggestion?: string };
export type WalkthroughChange = { file?: unknown; change?: unknown };
export type ReviewPending = { scores?: boolean; gates?: boolean; narrative?: boolean; readyScores?: Record<string, number> };
export type ReviewRecord = {
  pr: PullRequest;
  pending?: ReviewPending | null;
  error?: string | null;
  review?: { verdict?: string; summary?: string; scores?: Record<string, number>; findings?: ReviewFinding[]; walkthrough?: WalkthroughChange[] };
  blast?: { score?: number };
  gates?: ReviewGate[];
};
// A record with every score and a summary; see reviewComplete().
export type CompleteReviewRecord = ReviewRecord & { review: NonNullable<ReviewRecord["review"]> & { scores: Record<string, number>; summary: string }; blast: { score: number } };
export type Origins = Record<string, string>;
export type RepositoryBoard = { repos: string[]; reviewed: ReviewRecord[]; open: PullRequest[]; forgeUrls?: Origins; model?: string; store?: string };
export type RepositoryRow = { pr: PullRequest; record?: ReviewRecord; open?: boolean; error?: string; origins?: Origins };
export type ReviewSections = { scores: string; summary: string; details: string };
export type ReviewOptions = { signal?: AbortSignal; onProgress?: (record: ReviewRecord) => void; force?: boolean };
// The core/server.ts functions the repository client calls.
export type RepositoryCore = {
  repositoryBoard(org: string): Promise<RepositoryBoard>;
  repositoryReview(repo: string, pr: string, force: boolean): Promise<ReviewRecord>;
  repositoryDiff(repo: string, pr: string): Promise<unknown>;
};
export type RepositoryClient = {
  origin: string;
  board(org: string, signal?: AbortSignal): Promise<RepositoryBoard>;
  diff(repo: string, pr: PullRequest, signal?: AbortSignal): Promise<string>;
  review(repo: string, row: RepositoryRow, options?: ReviewOptions): Promise<ReviewRecord>;
};
type WalkthroughNode = { name: string; children: Map<string, WalkthroughNode>; descriptions: string[] };

const SCORE_KEYS = ["quality", "correctness_risk", "test_coverage", "readability", "pr_hygiene"];
const PLACEHOLDER = "░░░";
const PARAGRAPH = "░".repeat(30) + "\n" + "░".repeat(26) + "\n" + "░".repeat(18);
export function formatWalkthrough(changes: readonly WalkthroughChange[]): string {
  const root = new Map<string, WalkthroughNode>();
  for (const change of changes) {
    const parts = text(change.file).replaceAll("\\", "/").split("/").filter(Boolean);
    if (!parts.length) parts.push("(unknown file)");
    let children = root;
    for (const [index, name] of parts.entries()) {
      if (!children.has(name)) children.set(name, { name, children: new Map(), descriptions: [] });
      const node = children.get(name)!;
      if (index === parts.length - 1) node.descriptions.push(text(change.change));
      children = node.children;
    }
  }
  const lines: string[] = [];
  function draw(children: Map<string, WalkthroughNode>, prefix = "") {
    const nodes = [...children.values()].sort((a, b) => Number(!!b.children.size) - Number(!!a.children.size) || a.name.localeCompare(b.name));
    nodes.forEach((node, index) => {
      const last = index === nodes.length - 1;
      const continuation = prefix + (last ? "   " : "│  ");
      lines.push(`${prefix}${last ? "└─" : "├─"} ${node.name}${node.children.size ? "/" : ""}`);
      for (const description of node.descriptions) {
        lines.push(...description.split("\n").map(line => `${continuation}  ${line}`));
      }
      draw(node.children, continuation);
    });
  }
  draw(root);
  return lines.join("\n");
}
export function repositoryReviewSkeleton(pr?: PullRequest): ReviewSections {
  return {
    scores: [...SCORE_KEYS, "blast_radius"].map(key => `${key.padEnd(19)} ${PLACEHOLDER}/100`).join("\n"),
    summary: PARAGRAPH,
    details: [pr ? `#${pr.number} ${pr.title}` : "#░░░  " + "░".repeat(24), pr?.url || "░".repeat(30), "", `Verdict  ${PLACEHOLDER}`, "", "GATES", `${PLACEHOLDER}  ${"░".repeat(20)}`, `${PLACEHOLDER}  ${"░".repeat(16)}`, "", "FINDINGS", PARAGRAPH, "", "WALKTHROUGH", PARAGRAPH].join("\n"),
  };
}
export const repoFromPr = (pr: PullRequest | undefined, origins: Origins = {}) => repoFromUrl(pr?.url ?? "", origins);
export function reviewComplete(record: ReviewRecord | null | undefined): record is CompleteReviewRecord {
  return !!record && !record.pending && !record.error && SCORE_KEYS.every(k => Number.isFinite(record.review?.scores?.[k]))
    && Number.isFinite(record.blast?.score) && !!record.review?.summary?.trim();
}
export function repositoryRows(board: Omit<RepositoryBoard, "repos"> & { repos?: string[] }, repo: string): RepositoryRow[] {
  const rows = new Map<string, RepositoryRow>();
  for (const record of board.reviewed || []) {
    if (repoFromPr(record.pr, board.forgeUrls) === repo) rows.set(record.pr.url, { pr: record.pr, record, open: false });
  }
  for (const pr of board.open || []) {
    if (repoFromPr(pr, board.forgeUrls) === repo) rows.set(pr.url, { ...rows.get(pr.url), pr, open: true });
  }
  return [...rows.values()].sort((a, b) => Number(b.open) - Number(a.open) || b.pr.number - a.pr.number);
}
export function repositoryReviewSections(row: RepositoryRow | undefined): ReviewSections {
  if (!row) return { scores: "", summary: "", details: "No pull requests in this repository." };
  const { pr, record, error } = row;
  const skeleton = repositoryReviewSkeleton(pr);
  const lines: string[] = [`#${pr.number} ${pr.title}`, pr.url, ""];
  if (error) lines.push(`Review failed: ${error}`, "Press r to retry.", "");
  if (!record) return error
    ? { scores: skeleton.scores.replaceAll(PLACEHOLDER, "---"), summary: "Unavailable", details: text(lines.join("\n")) }
    : { scores: text(skeleton.scores), summary: text(skeleton.summary), details: text(skeleton.details) };
  const pending = record.pending;
  const verdicts: Record<string, string> = { approve: "Approved", comment: "Commented", request_changes: "Changes requested" };
  const verdict = verdicts[record.review?.verdict ?? ""];
  lines.push(`Verdict  ${verdict || (pending ? PLACEHOLDER : "---")}`, "");
  const scores: string[] = [];
  for (const key of SCORE_KEYS) {
    const value = pending?.scores ? pending.readyScores?.[key] : record.review?.scores?.[key];
    scores.push(`${key.padEnd(19)} ${Number.isFinite(value) ? `${value}/100` : pending?.scores ? `${PLACEHOLDER}/100` : "---"}`);
  }
  scores.push(`blast_radius        ${pending?.scores ? `${PLACEHOLDER}/100` : Number.isFinite(record.blast?.score) ? `${record.blast?.score}/100` : "---"}`);
  const summary = record.review?.summary || (pending?.narrative ? PARAGRAPH : "No summary returned.");
  lines.push(`GATES · ${record.gates?.length || 0}`, "─".repeat(28));
  for (const gate of record.gates || []) {
    lines.push(`  ${pending?.gates ? PLACEHOLDER : gate.pass ? "PASS" : "FAIL"}  ${gate.label}`);
    if (gate.explanation) lines.push(...text(gate.explanation).split("\n").map(line => `        ${line}`));
  }
  if (!record.gates?.length) lines.push(pending?.gates ? `${PLACEHOLDER}  ${"░".repeat(20)}` : "None");
  lines.push("", `FINDINGS · ${record.review?.findings?.length || 0}`, "─".repeat(28));
  if (!record.review?.findings?.length) lines.push(pending?.narrative ? PARAGRAPH : "None");
  for (const [index, finding] of (record.review?.findings || []).entries()) {
    lines.push("", `${index + 1}. [${text(finding.severity).toUpperCase()}] ${finding.title}`, `   ${finding.file}${finding.line ? `:${finding.line}` : ""}`, "", ...text(finding.detail).split("\n").map(line => `   ${line}`));
    if (finding.suggestion) lines.push("", "   Suggestion", ...text(finding.suggestion).split("\n").map(line => `   │ ${line}`));
  }
  lines.push("", `WALKTHROUGH · ${record.review?.walkthrough?.length || 0}`, "─".repeat(28));
  if (!record.review?.walkthrough?.length) lines.push(pending?.narrative ? PARAGRAPH : "None");
  if (record.review?.walkthrough?.length) lines.push(formatWalkthrough(record.review.walkthrough));
  return { scores: text(scores.join("\n")), summary: text(summary), details: text(lines.join("\n")) };
}
export function formatRepositoryReview(row: RepositoryRow | undefined): string {
  const sections = repositoryReviewSections(row);
  return [sections.details, sections.scores, sections.summary].filter(Boolean).join("\n\n");
}

export function createRepositoryClient({ core: suppliedCore, pollMs = 1000 }: { core?: RepositoryCore; pollMs?: number } = {}): RepositoryClient {
  // Lazy import: the UI can show initialization errors instead of exiting before rendering.
  let core: Promise<RepositoryCore> | undefined;
  const services = (): Promise<RepositoryCore> => core ||= suppliedCore ? Promise.resolve(suppliedCore) : import("../core/server.ts");
  return {
    origin: "Local CodeOtter",
    async board(org, signal) {
      signal?.throwIfAborted();
      const result = await (await services()).repositoryBoard(org);
      signal?.throwIfAborted();
      return result;
    },
    async diff(repo, pr, signal) {
      signal?.throwIfAborted();
      const result = await (await services()).repositoryDiff(repo, pr.url);
      signal?.throwIfAborted();
      return text(result);
    },
    async review(repo, row, { signal, onProgress, force = false }: ReviewOptions = {}) {
      if (repoFromPr(row.pr, row.origins) !== repo) throw new Error("Pull request is outside the selected repository.");
      const shared = await services();
      let first = true;
      for (let attempts = 0; attempts < 600; attempts++) {
        signal?.throwIfAborted();
        const data = await shared.repositoryReview(repo, row.pr.url,
          first && (force || !!(row.record && !row.record.pending && !reviewComplete(row.record))));
        first = false;
        signal?.throwIfAborted();
        onProgress?.(data);
        if (!data.pending) {
          if (!reviewComplete(data)) throw new Error("The model returned an incomplete review. Check model configuration in the web app.");
          return data;
        }
        await delay(pollMs, undefined, { signal });
      }
      throw new Error("Review is still running. Press g to refresh.");
    },
  };
}
