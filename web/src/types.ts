export type PrFile = { path: string; additions: number; deletions: number };
export type Pr = {
  number: number;
  title: string;
  body: string;
  url: string;
  author: { login: string };
  baseRefName: string;
  headRefName: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  files: PrFile[];
};
export type OpenPr = Pick<Pr, "number" | "title" | "url" | "author" | "additions" | "deletions" | "changedFiles"> & { updatedAt: string };
export type Finding = { file: string; severity: "high" | "medium" | "low" | "nit"; title: string; detail: string };
export type Review = {
  pr: Pr;
  blast: { score: number; files: number; lines: number; dirs: number; hotspots: string[]; testFiles: number };
  review: {
    summary: string;
    verdict: "approve" | "comment" | "request_changes";
    scores: { quality: number; correctness_risk: number; test_coverage: number; readability: number; pr_hygiene: number };
    findings: Finding[];
    walkthrough: { file: string; change: string }[];
  };
  model: string;
  at: string;
};
export type User = { id: string; name: string; email: string; role: string; avatar: string };
export type Board = { repo: string; repos: string[]; model: string; baseUrl: string; store: string; settingsPages: { id: string; title: string; group: "settings" | "admin" }[]; reviewed: Review[]; open: OpenPr[] };

export const VERDICT = { approve: ["Approved", "ok"], comment: ["Commented", "warn"], request_changes: ["Changes requested", "bad"] } as const;
export const tone = (v: number, invert = false) => {
  const x = invert ? 100 - v : v;
  return x >= 70 ? "ok" : x >= 40 ? "warn" : "bad";
};
export const effort = (score: number, lines: number) => {
  const n = score >= 80 ? 5 : score >= 60 ? 4 : score >= 40 ? 3 : score >= 20 ? 2 : 1;
  return { n, label: ["Trivial", "Simple", "Moderate", "Complex", "Critical"][n - 1], mins: Math.max(5, Math.round(lines / 8 / 5) * 5) };
};
