// Runs the real <pr-tools> block from core/server.ts with the forge, gh and model calls stubbed, so nothing leaves the machine.
import { serverBlocks } from "./server-blocks.ts";

// What the <pr-tools> block returns, as far as the tests read it.
export interface PrTool { label: unknown; applyLabel?: unknown; apply?: unknown; input?: unknown }
export interface Suggestion { title: string; startLine?: number; line: number; label: string; severity: string; confidence: number }
export interface PrToolResult { markdown: string; message?: string; data: { suggestions: Suggestion[] } }
export interface PrTools {
  PR_TOOLS: Record<string, PrTool>;
  runPrTool: (url: string, id: string, opts?: { question?: string; action?: string }) => Promise<PrToolResult>;
}
type Extra = [marker: string, body: string, label: string];
type InlineCall = { r: { review: { findings: unknown[] } }; repo: string };
interface Detail { startLine?: number; line: number }

export function loadTools({ answer, body = "Author text.", reflectMin = 0, files = {} }: { answer: string | ((prompt: string) => string); body?: string; reflectMin?: number; files?: Record<string, string> }) {
  const calls: { prompts: string[]; comments: { repo: string; extra: Extra[] }[]; bodies: string[]; inline: InlineCall[] } = { prompts: [], comments: [], bodies: [], inline: [] };
  const pr = { url: "https://github.com/acme/shop/pull/7", number: 7, title: "fix totals", body, author: { login: "dev" }, baseRefName: "main", headRefName: "fix", headRefOid: "abc1234", changedFiles: 1, additions: 2, deletions: 1 };
  const diff = "diff --git a/src/cart.js b/src/cart.js\n--- a/src/cart.js\n+++ b/src/cart.js\n@@ -1,2 +1,3 @@\n export function total(items) {\n-  return sum(items);\n+  const t = sum(items);\n+  return t * 1.15;";
  const stubs: Record<string, unknown> = {
    APP_URL: "http://localhost:4747",
    askModel: async (text: string) => { calls.prompts.push(text); return typeof answer === "function" ? answer(text) : answer; },
    resolvePr: async (url: string) => ({ urlGuess: url, spec: [url] }),
    readPr: async (_u: string, _s: string[], isDiff?: boolean) => (isDiff ? diff : JSON.stringify(pr)),
    llmConfig: async () => ({ provider: "test", model: "stub" }),
    reviewConfig: async () => ({ contextLines: 0, diffChars: 90000, maxFindings: 8, reflectMin }),
    headFileTexts: async (_pr: unknown, paths: string[]) => new Map(paths.filter((p) => p in files).map((p) => [p, files[p]])),
    guideFor: async () => ({ file: "AGENTS.md", text: "Titles use the imperative mood." }),
    repoOf: (p: { url: string }) => (p.url.match(/github\.com\/([^/]+\/[^/]+)\/pull/) || [])[1] || "",
    isForgeRepo: () => false,
    parsePrUrl: (u: string) => ({ repo: "acme/shop", number: Number(u.split("/").pop()) }),
    forgeApi: async () => { throw new Error("forge not expected"); },
    ghAsync: async (...args: string[]) => { calls.bodies.push(String(args.at(-1)).replace(/^body=/, "")); return "{}"; },
    syncPrComments: async (_r: unknown, repo: string, { extra }: { extra: Extra[] }) => { calls.comments.push({ repo, extra }); return extra.map((e) => e[2]); },
    deriveSuggestionFromDetail: (f: Detail) => ({ ...f, ...((f.startLine ?? Infinity) < f.line ? {} : { startLine: undefined }) }),
    postInlineSuggestionsOnPr: async (r: InlineCall["r"], repo: string) => { calls.inline.push({ r, repo }); return { posted: r.review.findings.length, mode: "inline_review" }; },
  };
  const names = Object.keys(stubs);
  const run = new Function(...names, `${serverBlocks("dynamic-context", "diff-compression", "reflect", "pr-tools")}; return { PR_TOOLS, runPrTool };`);
  return { ...(run(...names.map((n) => stubs[n])) as PrTools), calls, pr };
}
