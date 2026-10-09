import { setTimeout as delay } from "node:timers/promises";
import { text } from "./review-output.mjs";

const SCORE_KEYS = ["quality", "correctness_risk", "test_coverage", "readability", "pr_hygiene"];
const PLACEHOLDER = "░░░";
const PARAGRAPH = "░".repeat(30) + "\n" + "░".repeat(26) + "\n" + "░".repeat(18);
export function formatWalkthrough(changes) {
  const root = new Map();
  for (const change of changes) {
    const parts = text(change.file).replaceAll("\\", "/").split("/").filter(Boolean);
    if (!parts.length) parts.push("(unknown file)");
    let children = root;
    for (const [index, name] of parts.entries()) {
      if (!children.has(name)) children.set(name, { name, children: new Map(), descriptions: [] });
      const node = children.get(name);
      if (index === parts.length - 1) node.descriptions.push(text(change.change));
      children = node.children;
    }
  }
  const lines = [];
  function draw(children, prefix = "") {
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
export function repositoryReviewSkeleton(pr) {
  return {
    scores: [...SCORE_KEYS, "blast_radius"].map(key => `${key.padEnd(19)} ${PLACEHOLDER}/100`).join("\n"),
    summary: PARAGRAPH,
    details: [pr ? `#${pr.number} ${pr.title}` : "#░░░  " + "░".repeat(24), pr?.url || "░".repeat(30), "", `Verdict  ${PLACEHOLDER}`, "", "GATES", `${PLACEHOLDER}  ${"░".repeat(20)}`, `${PLACEHOLDER}  ${"░".repeat(16)}`, "", "FINDINGS", PARAGRAPH, "", "WALKTHROUGH", PARAGRAPH].join("\n"),
  };
}
export function repoFromPr(pr, origins = {}) {
  try {
    const url = new URL(pr.url);
    const forge = Object.keys(origins).find(id => origins[id] === url.origin);
    if (url.origin !== "https://github.com" && !forge) return "";
    return `${forge ? `${forge}~` : ""}${url.pathname.split("/").slice(1, 3).join("/")}`;
  } catch { return ""; }
}
export function reviewComplete(record) {
  return !!record && !record.pending && !record.error && SCORE_KEYS.every(k => Number.isFinite(record.review?.scores?.[k]))
    && Number.isFinite(record.blast?.score) && !!record.review?.summary?.trim();
}
export function repositoryRows(board, repo) {
  const rows = new Map();
  for (const record of board.reviewed || []) {
    if (repoFromPr(record.pr, board.forgeUrls) === repo) rows.set(record.pr.url, { pr: record.pr, record, open: false });
  }
  for (const pr of board.open || []) {
    if (repoFromPr(pr, board.forgeUrls) === repo) rows.set(pr.url, { ...rows.get(pr.url), pr, open: true });
  }
  return [...rows.values()].sort((a, b) => Number(b.open) - Number(a.open) || b.pr.number - a.pr.number);
}
export function repositoryReviewSections(row) {
  if (!row) return { scores: "", summary: "", details: "No pull requests in this repository." };
  const { pr, record, error } = row;
  const skeleton = repositoryReviewSkeleton(pr);
  const lines = [`#${pr.number} ${pr.title}`, pr.url, ""];
  if (error) lines.push(`Review failed: ${error}`, "Press r to retry.", "");
  if (!record) return error
    ? { scores: skeleton.scores.replaceAll(PLACEHOLDER, "---"), summary: "Unavailable", details: text(lines.join("\n")) }
    : Object.fromEntries(Object.entries(skeleton).map(([key, value]) => [key, text(value)]));
  const pending = record.pending;
  const verdict = { approve: "Approved", comment: "Commented", request_changes: "Changes requested" }[record.review?.verdict];
  lines.push(`Verdict  ${verdict || (pending ? PLACEHOLDER : "---")}`, "");
  const scores = [];
  for (const key of SCORE_KEYS) {
    const value = pending?.scores ? pending.readyScores?.[key] : record.review?.scores?.[key];
    scores.push(`${key.padEnd(19)} ${Number.isFinite(value) ? `${value}/100` : pending?.scores ? `${PLACEHOLDER}/100` : "---"}`);
  }
  scores.push(`blast_radius        ${pending?.scores ? `${PLACEHOLDER}/100` : Number.isFinite(record.blast?.score) ? `${record.blast.score}/100` : "---"}`);
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
export function formatRepositoryReview(row) {
  const sections = repositoryReviewSections(row);
  return [sections.details, sections.scores, sections.summary].filter(Boolean).join("\n\n");
}

export function createRepositoryClient({ core: suppliedCore, pollMs = 1000 } = {}) {
  // Lazy import: the UI can show initialization errors instead of exiting before rendering.
  let core;
  const services = () => core ||= suppliedCore ? Promise.resolve(suppliedCore) : import("../server.mjs");
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
    async review(repo, row, { signal, onProgress, force = false } = {}) {
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
