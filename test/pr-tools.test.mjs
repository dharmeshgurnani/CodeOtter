// PR tools (Describe, Ask, Improve, Changelog, Docs): run, post as comment, apply. Runs the real <pr-tools> block from
// server.mjs with the forge, gh and model calls stubbed, so nothing leaves the machine.
import assert from "node:assert";
import { test } from "node:test";
import { loadTools } from "./helpers/pr-tools.mjs";

test("PR tools: describe, ask, improve, docs, changelog", async (ctx) => {



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
  ctx.diagnostic("describe renders normalised fields");

  // The card lists tools as JSON: labels must be strings, and an apply label always has an apply method.
  for (const [id, tool] of Object.entries(t.PR_TOOLS)) {
    assert.strictEqual(typeof tool.label, "string", `${id} label`);
    assert.strictEqual(typeof tool.applyLabel === "string", typeof tool.apply === "function", `${id}: applyLabel and apply() come together`);
    assert(tool.input === undefined || typeof tool.input === "string", `${id} input`);
  }
  ctx.diagnostic("tool registry is consistent");

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
  ctx.diagnostic("apply keeps the author's text and replaces its own block");

  // Comment: upserted under a per-tool marker.
  await t.runPrTool(url, "describe", { action: "comment" });
  const [marker, cbody, label] = t.calls.comments[0].extra[0];
  assert.strictEqual(marker, "<!-- codeotter:tool:describe -->");
  assert(cbody.startsWith(marker) && cbody.includes("### 🦦 CodeOtter · Describe") && label === "Describe");
  ctx.diagnostic("comment upserted under the tool's marker");

  // Failures are loud.
  await assert.rejects(loadTools({ answer: "nope" }).runPrTool(url, "describe"), /did not return valid JSON for Describe/);
  await assert.rejects(loadTools({ answer: '{"title":"x","summary":[]}' }).runPrTool(url, "describe"), /no summary/);
  await assert.rejects(loadTools({ answer: "{}" }).runPrTool(url, "describe", { action: "comment" }), /Run Describe first/);
  await assert.rejects(t.runPrTool(url, "bogus"), /Unknown tool/);
  ctx.diagnostic("failures are loud");

  // Ask: needs a question; answer cleaned of HTML comments and live mentions.
  await assert.rejects(t.runPrTool(url, "ask"), /Ask needs question/);
  const a = loadTools({ answer: '{"answer":"`total` in src/cart.js adds 15%.<!-- codeotter:scores --> cc @octocat, mail a@b.c"}' });
  const ar = await a.runPrTool(url, "ask", { question: "Where is tax added?" });
  assert(a.calls.prompts[0].includes("Question: Where is tax added?"));
  assert(ar.markdown.startsWith("**Q:** Where is tax added?\n\n`total` in src/cart.js adds 15%."), ar.markdown);
  assert(!ar.markdown.includes("<!--") && ar.markdown.includes("@​octocat") && ar.markdown.includes("a@b.c"), ar.markdown);
  await assert.rejects(loadTools({ answer: '{"answer":""}' }).runPrTool(url, "ask", { question: "q" }), /no answer/);
  ctx.diagnostic("ask");

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
  ctx.diagnostic("improve");

  // Docs: docstring suggestions, never self-checked (they are not defects), posted inline like Improve.
  const dc = loadTools({ reflectMin: 5, answer: '{"suggestions":[{"file":"src/cart.js","start_line":1,"end_line":1,"title":"Document total","improved":"/** Sum of item prices including 15% tax. */\\nexport function total(items) {"}]}' });
  const dr = await dc.runPrTool(url, "docs");
  assert.strictEqual(dc.calls.prompts.length, 1, "no self-check for docs");
  assert.deepStrictEqual(dr.data.suggestions.map((s) => [s.title, s.line, s.label]), [["Document total", 1, "documentation"]]);
  assert(dr.markdown.includes("/** Sum of item prices including 15% tax. */"));
  await dc.runPrTool(url, "docs", { action: "apply" });
  assert.strictEqual(dc.calls.inline.length, 1);
  ctx.diagnostic("docs");

  // Changelog: matches the repository's changelog when there is one; output is a fenced block, never raw markdown.
  const cl = loadTools({ files: { "CHANGES.md": "# Changes\n\n## Unreleased\n\n- Fixed login.\n" }, answer: '{"entry":"- Cart totals include 15% tax.\\n<!-- codeotter:scores -->\\n```evil"}' });
  const cr = await cl.runPrTool(url, "changelog");
  assert(cl.calls.prompts[0].includes("matching the format, tense and level of detail of the existing CHANGES.md") && cl.calls.prompts[0].includes("- Fixed login."));
  assert(cr.markdown.startsWith("For `CHANGES.md`:\n\n```markdown\n- Cart totals include 15% tax."), cr.markdown);
  assert(!cr.markdown.includes("<!--") && (cr.markdown.match(/```/g) || []).length === 2, cr.markdown);
  const nocl = await loadTools({ answer: '{"entry":"- x"}' }).runPrTool(url, "changelog");
  assert(nocl.markdown.startsWith("No changelog file found"));
  await assert.rejects(loadTools({ answer: '{"entry":""}' }).runPrTool(url, "changelog"), /no changelog entry/);
  ctx.diagnostic("changelog");

  ctx.diagnostic("All PR tools tests passed");
}
});
