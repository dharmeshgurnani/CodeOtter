// Runs the real <pr-tools> block from core/server.mjs with the forge, gh and model calls stubbed, so nothing leaves the machine.
import { serverBlocks } from "./server-blocks.mjs";

export function loadTools({ answer, body = "Author text.", reflectMin = 0, files = {} }) {
  const calls = { prompts: [], comments: [], bodies: [] };
  const pr = { url: "https://github.com/acme/shop/pull/7", number: 7, title: "fix totals", body, author: { login: "dev" }, baseRefName: "main", headRefName: "fix", headRefOid: "abc1234", changedFiles: 1, additions: 2, deletions: 1 };
  const diff = "diff --git a/src/cart.js b/src/cart.js\n--- a/src/cart.js\n+++ b/src/cart.js\n@@ -1,2 +1,3 @@\n export function total(items) {\n-  return sum(items);\n+  const t = sum(items);\n+  return t * 1.15;";
  const stubs = {
    APP_URL: "http://localhost:4747",
    askModel: async (text) => { calls.prompts.push(text); return typeof answer === "function" ? answer(text) : answer; },
    resolvePr: async (url) => ({ urlGuess: url, spec: [url] }),
    readPr: async (_u, _s, isDiff) => (isDiff ? diff : JSON.stringify(pr)),
    llmConfig: async () => ({ provider: "test", model: "stub" }),
    reviewConfig: async () => ({ contextLines: 0, diffChars: 90000, maxFindings: 8, reflectMin }),
    headFileTexts: async (_pr, paths) => new Map(paths.filter((p) => p in files).map((p) => [p, files[p]])),
    guideFor: async () => ({ file: "AGENTS.md", text: "Titles use the imperative mood." }),
    repoOf: (p) => (p.url.match(/github\.com\/([^/]+\/[^/]+)\/pull/) || [])[1] || "",
    isForgeRepo: () => false,
    parsePrUrl: (u) => ({ repo: "acme/shop", number: Number(u.split("/").pop()) }),
    forgeApi: async () => { throw new Error("forge not expected"); },
    ghAsync: async (...args) => { calls.bodies.push(args.at(-1).replace(/^body=/, "")); return "{}"; },
    syncPrComments: async (_r, repo, { extra }) => { calls.comments.push({ repo, extra }); return extra.map((e) => e[2]); },
    deriveSuggestionFromDetail: (f) => ({ ...f, ...(f.startLine < f.line ? {} : { startLine: undefined }) }),
    postInlineSuggestionsOnPr: async (r, repo) => { calls.inline.push({ r, repo }); return { posted: r.review.findings.length, mode: "inline_review" }; },
  };
  calls.inline = [];
  const names = Object.keys(stubs);
  const run = new Function(...names, `${serverBlocks("dynamic-context", "diff-compression", "reflect", "pr-tools")}; return { PR_TOOLS, runPrTool };`);
  return { ...run(...names.map((n) => stubs[n])), calls, pr };
}
