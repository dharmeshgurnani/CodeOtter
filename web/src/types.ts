export type PrFile = { path: string; additions: number; deletions: number };
export type Pr = {
  number: number;
  title: string;
  body: string;
  url: string;
  author: { login: string };
  baseRefName: string;
  headRefName: string;
  headSha?: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  files: PrFile[];
};
export type OpenPr = Pick<Pr, "number" | "title" | "url" | "author" | "additions" | "deletions" | "changedFiles"> & { updatedAt: string };
export type Finding = {
  file: string;
  line?: number;
  severity: "high" | "medium" | "low" | "nit";
  title: string;
  detail: string;
  suggestion?: string;
  dismissed?: boolean;
  confidence?: number;
};
export type Review = {
  pr: Pr;
  headSha?: string;
  incremental?: {
    prevSha: string;
    headSha: string;
    newCommits: { sha: string; message: string; author?: string }[];
    resolvedFindings?: Finding[];
  };
  blast: { score: number; files: number; lines: number; dirs: number; hotspots: string[]; testFiles: number; outsideCallers?: number; outsideFiles?: number; source?: "s1" };
  outsideDiffImpact?: {
    symbols: string[];
    callers: { symbol: string; file: string; line: number; snippet: string }[];
    outsideCallers: number;
    uniqueFiles: number;
    formatted: string;
  };
  review: {
    summary: string;
    verdict: "approve" | "comment" | "request_changes";
    scores: { quality: number; correctness_risk: number; test_coverage: number; readability: number; pr_hygiene: number };
    findings: Finding[];
    walkthrough: { file: string; change: string }[];
    rawOutput?: string;
  };
  model: string;
  guide?: string | null;
  learnings?: string[];
  linkedIssues?: { number: number; repo?: string; title: string; body?: string; state?: string; url: string; labels?: string[] }[];
  gitHistory?: {
    prCommits?: { sha: string; message: string; author?: string }[];
    baseCommits?: { sha: string; message: string; author?: string }[];
  };
  gates?: { id: string; label: string; yes: number; pass: boolean }[];
  engines?: { llm: string | null; s1: string | null };
  pending?: {
    scores?: boolean;
    readyScores?: Record<string, number>;
    gates?: boolean;
    narrative?: boolean;
  };
  commentsPosted?: string[];
  commentError?: string;
  at: string;
};
export type User = { id: string; name: string; email: string; role: string; avatar: string };
export type Board = { repo: string; repos: string[]; onboardingNeeded?: boolean; forgejoUrl?: string; forgeUrls?: Record<string, string>; model: string; baseUrl: string; store: string; update?: { version: string; url: string } | null; settingsPages: { id: string; title: string; group: "settings" | "admin" | "workspace" | "repo" }[]; reviewed: Review[]; open: OpenPr[] };

// A pull request URL's repository id, given the configured origins (provider id -> origin). Same rules as repoFromUrl in
// core/forges.mjs: owner/name for GitHub, Forgejo, Gitea and Bitbucket; PROJECT/repo for Bitbucket Data Center
// (/projects/P/repos/r/...); org/project/repo for Azure DevOps (/org/project/_git/repo/...).
export const repoFromUrl = (url: string, origins: Record<string, string> = {}) => {
  try {
    const u = new URL(url);
    const source = Object.keys(origins).find((id) => origins[id] && origins[id] === u.origin);
    if (u.origin !== "https://github.com" && !source) return "";
    const seg = u.pathname.split("/").slice(1);
    if (source === "bitbucketdc") return seg[0] === "projects" && seg[2] === "repos" ? `${source}~${seg[1]}/${seg[3]}` : "";
    if (source === "azure") return seg[2] === "_git" ? `${source}~${[seg[0], seg[1], seg[3]].map(decodeURIComponent).join("/")}` : "";
    return `${source ? `${source}~` : ""}${seg.slice(0, 2).join("/")}`;
  } catch { return ""; }
};
export const FORGE_LABELS: Record<string, string> = { forgejo: "Forgejo", gitea: "Gitea", bitbucket: "Bitbucket", bitbucketdc: "Bitbucket Data Center", azure: "Azure DevOps" };
export const FORGE_PREFIX = /^(forgejo|gitea|bitbucket|bitbucketdc|azure)~/;
export const forgeId = (id: string) => FORGE_PREFIX.exec(id)?.[1] || "";
export const forgeLabel = (id: string) => FORGE_LABELS[forgeId(id)] || "GitHub";
export const repoLabel = (id: string) => forgeId(id) ? `${id.replace(FORGE_PREFIX, "")} · ${forgeLabel(id)}` : id;
// Repository ids have two segments, three for Azure DevOps (org/project/repo).
export const repoSegments = (id: string) => (id.startsWith("azure~") ? 3 : 2);

export const VERDICT = { approve: ["Approved", "ok"], comment: ["Commented", "warn"], request_changes: ["Changes requested", "bad"] } as const;
export const tone = (v: number, invert = false) => {
  const x = invert ? 100 - v : v;
  return x >= 70 ? "ok" : x >= 40 ? "warn" : "bad";
};
export const effort = (score: number, lines: number) => {
  const n = score >= 80 ? 5 : score >= 60 ? 4 : score >= 40 ? 3 : score >= 20 ? 2 : 1;
  return { n, label: ["Trivial", "Simple", "Moderate", "Complex", "Critical"][n - 1], mins: Math.max(5, Math.round(lines / 8 / 5) * 5) };
};
// Badge tone for an effort level: 1-2 green, 3 amber, 4-5 red.
export const effortTone = (n: number) => (n <= 2 ? "ok" : n === 3 ? "warn" : "bad");
