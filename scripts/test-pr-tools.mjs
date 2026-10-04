// PR tools (Describe, Ask, Improve, Changelog, Docs): run, post as comment, apply. Runs the real <pr-tools> block from
// server.mjs with the forge, gh and model calls stubbed, so nothing leaves the machine.
import assert from "node:assert";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
const block = (name) => src.slice(src.indexOf(`// <${name}>`), src.indexOf(`// </${name}>`));

export function loadTools({ answer, body = "Author text.", reflectMin = 0 }) {
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
    headFileTexts: async () => new Map(),
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
  const run = new Function(...names, `${block("dynamic-context")}\n${block("diff-compression")}\n${block("reflect")}\n${block("pr-tools")}; return { PR_TOOLS, runPrTool };`);
  return { ...run(...names.map((n) => stubs[n])), calls, pr };
}

const url = "https://github.com/acme/shop/pull/7";
if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}` || process.argv[1].endsWith("test-pr-tools.mjs")) {
  // Describe: rendered from normalised fields, unknown types dropped, injection in table cells neutralised.
  const t = loadTools({ answer: 'ok {"title":"Add tax to cart totals","type":["Bug fix","Nonsense"],"summary":["Totals now include 15% tax."],"files":[{"file":"src/cart.js","change":"multiply | by `1.15`"}]}' });
  assert.deepStrictEqual(Object.keys(t.PR_TOOLS).includes("describe"), true);
  const r = await t.runPrTool(url, "describe");
  assert(r.markdown.includes("**Title:** Add tax to cart totals"));
  assert(r.markdown.includes("**Type:** Bug fix") && !r.markdown.includes("Nonsense"));
  assert(r.markdown.includes("| `src/cart.js` | multiply \\| by '1.15' |"), r.markdown);
  assert(t.calls.prompts[0].includes("Titles use the imperative mood.") && t.calls.prompts[0].includes("+  return t * 1.15;"));
  console.log("✓ describe renders normalised fields");

  // The card lists tools as JSON: labels must be strings, and an apply label always has an apply method.
  for (const [id, tool] of Object.entries(t.PR_TOOLS)) {
    assert.strictEqual(typeof tool.label, "string", `${id} label`);
    assert.strictEqual(typeof tool.applyLabel === "string", typeof tool.apply === "function", `${id}: applyLabel and apply() come together`);
    assert(tool.input === undefined || typeof tool.input === "string", `${id} input`);
  }
  console.log("✓ tool registry is consistent");

  // Apply keeps the author's text and replaces its own block on a second run.
  await t.runPrTool(url, "describe", { action: "apply" });
  const first = t.calls.bodies.at(-1);
  assert(first.startsWith("Author text.\n\n<!-- codeotter:describe -->") && first.endsWith("<!-- /codeotter:describe -->"), first);
  const again = loadTools({ answer: '{"title":"T2","type":[],"summary":["second"],"files":[]}', body: first });
  await again.runPrTool(url, "describe");
  await again.runPrTool(url, "describe", { action: "apply" });
  const second = again.calls.bodies.at(-1);
  assert.strictEqual((second.match(/<!-- codeotter:describe -->/g) || []).length, 1, "one block");
  assert(second.startsWith("Author text.") && second.includes("- second") && !second.includes("Add tax"), second);
  assert(!again.calls.prompts[0].includes("Add tax to cart totals"), "previous generated block is not fed back to the model");
  console.log("✓ apply keeps the author's text and replaces its own block");

  // Comment: upserted under a per-tool marker.
  await t.runPrTool(url, "describe", { action: "comment" });
  const [marker, cbody, label] = t.calls.comments[0].extra[0];
  assert.strictEqual(marker, "<!-- codeotter:tool:describe -->");
  assert(cbody.startsWith(marker) && cbody.includes("### 🦦 CodeOtter · Describe") && label === "Describe");
  console.log("✓ comment upserted under the tool's marker");

  // Failures are loud.
  await assert.rejects(loadTools({ answer: "nope" }).runPrTool(url, "describe"), /did not return valid JSON for Describe/);
  await assert.rejects(loadTools({ answer: '{"title":"x","summary":[]}' }).runPrTool(url, "describe"), /no summary/);
  await assert.rejects(loadTools({ answer: "{}" }).runPrTool(url, "describe", { action: "comment" }), /Run Describe first/);
  await assert.rejects(t.runPrTool(url, "bogus"), /Unknown tool/);
  console.log("✓ failures are loud");

  // Ask: needs a question; answer cleaned of HTML comments and live mentions.
  await assert.rejects(t.runPrTool(url, "ask"), /Ask needs question/);
  const a = loadTools({ answer: '{"answer":"`total` in src/cart.js adds 15%.<!-- codeotter:scores --> cc @octocat, mail a@b.c"}' });
  const ar = await a.runPrTool(url, "ask", { question: "Where is tax added?" });
  assert(a.calls.prompts[0].includes("Question: Where is tax added?"));
  assert(ar.markdown.startsWith("**Q:** Where is tax added?\n\n`total` in src/cart.js adds 15%."), ar.markdown);
  assert(!ar.markdown.includes("<!--") && ar.markdown.includes("@​octocat") && ar.markdown.includes("a@b.c"), ar.markdown);
  await assert.rejects(loadTools({ answer: '{"answer":""}' }).runPrTool(url, "ask", { question: "q" }), /no answer/);
  console.log("✓ ask");

  // Improve: suggestions normalised, scored by the self-check, rendered with safe fences, posted inline on apply.
  const sug = { suggestions: [
    { file: "src/cart.js", start_line: 2, end_line: 3, label: "possible issue", title: "Tax rate is hard-coded", why: "Use the configured rate. cc @octocat", improved: "  const t = sum(items);\n  return t * (1 + TAX_RATE);" },
    { file: "src/cart.js", start_line: 3, end_line: 3, label: "nonsense", title: "Name it", why: "style", improved: "  return total * 1.15; // ```" },
    { file: "src/cart.js", end_line: 0, improved: "dropped: no line" },
  ] };
  const im = loadTools({ reflectMin: 5, answer: (p) => (p.startsWith("You are checking") ? '{"scores":[{"index":0,"score":8},{"index":1,"score":2}]}' : JSON.stringify(sug)) });
  const ir = await im.runPrTool(url, "improve");
  assert.strictEqual(im.calls.prompts.length, 2, "suggestions, then self-check");
  assert.deepStrictEqual(ir.data.suggestions.map((s) => [s.title, s.startLine, s.line, s.label, s.severity, s.confidence]), [["Tax rate is hard-coded", 2, 3, "possible issue", "medium", 0.8]]);
  assert(ir.markdown.includes("**1. Tax rate is hard-coded** · `src/cart.js:L2-3` · possible issue · 8/10"), ir.markdown);
  assert(ir.markdown.includes("@​octocat"));
  await im.runPrTool(url, "improve", { action: "apply" });
  assert.strictEqual(im.calls.inline[0].r.review.findings.length, 1);
  assert.strictEqual(im.calls.inline[0].repo, "acme/shop");
  const nofilter = loadTools({ answer: JSON.stringify(sug) });
  const nr = await nofilter.runPrTool(url, "improve");
  assert.strictEqual(nr.data.suggestions.length, 2, "no self-check when off; invalid rows dropped");
  assert.strictEqual(nr.data.suggestions[1].label, "enhancement", "unknown label falls back");
  assert(nr.markdown.includes("````\n  return total * 1.15; // ```\n````"), "fence longer than any backtick run in the code");
  const empty = loadTools({ answer: '{"suggestions":[]}' });
  assert.strictEqual((await empty.runPrTool(url, "improve")).markdown, "No suggestions.");
  await assert.rejects(empty.runPrTool(url, "improve", { action: "apply" }), /No suggestions to post/);
  console.log("✓ improve");

  console.log("All PR tools tests passed");
}
